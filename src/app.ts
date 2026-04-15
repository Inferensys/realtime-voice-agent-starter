import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadRuntimeConfig } from "./config";
import {
  CallSession,
  callStartSchema,
  handoffRequestSchema,
  postCallRequestSchema,
  realtimeEventSchema
} from "./contracts";
import { DomainError } from "./domain/errors";
import { SessionStore } from "./domain/session-store";
import { processRealtimeEvent, requestHandoff } from "./services/event-processor";
import { buildPostCallSummary } from "./services/postcall";

function nowIso(): string {
  return new Date().toISOString();
}

function fallbackCorrelationId(callId: string): string {
  return `corr_${callId}`;
}

function createSession(payload: z.infer<typeof callStartSchema>): CallSession {
  const now = nowIso();
  return {
    callId: payload.call_id,
    source: payload.source,
    callerPhone: payload.caller.phone_e164,
    callerLocale: payload.caller.locale,
    tenant: payload.context.tenant,
    queue: payload.context.queue,
    state: "initiated",
    correlationId: payload.context.request_id ?? fallbackCorrelationId(payload.call_id),
    allowHandoff: payload.capabilities.allow_handoff,
    allowToolCalls: payload.capabilities.allow_tool_calls,
    createdAt: now,
    updatedAt: now,
    turnCount: 0,
    transcript: [],
    seenEventIds: new Set<string>()
  };
}

function sessionResponse(session: CallSession) {
  return {
    call_id: session.callId,
    state: session.state,
    correlation_id: session.correlationId,
    turn_count: session.turnCount,
    transcript_segments: session.transcript.length,
    handoff: session.handoff ?? null,
    post_summary: session.postSummary ?? null
  };
}

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new SessionStore();
  const config = loadRuntimeConfig();

  app.decorate("sessionStore", store);
  app.decorate("runtimeConfig", config);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      void reply.status(error.statusCode).send({
        code: error.code,
        message: error.message
      });
      return;
    }
    app.log.error(error);
    const message = error instanceof Error ? error.message : "Unknown internal error";
    void reply.status(500).send({
      code: "internal_error",
      message
    });
  });

  app.get("/healthz", async () => ({ ok: true, handoff_timeout_seconds: config.session.handoff_timeout_seconds }));

  app.post("/api/calls/start", async (request, reply) => {
    const payload = callStartSchema.parse(request.body);
    const session = createSession(payload);
    store.create(session);
    return reply.status(201).send(sessionResponse(session));
  });

  app.post("/api/calls/:id/events", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const payload = realtimeEventSchema.parse(request.body);
    const session = store.getOrThrow(params.id);
    processRealtimeEvent(session, payload);
    store.replace(session);
    return sessionResponse(session);
  });

  app.post("/api/calls/:id/handoff", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const payload = handoffRequestSchema.parse(request.body);
    const session = store.getOrThrow(params.id);
    const envelope = requestHandoff(session, payload);
    store.replace(session);
    return {
      session: sessionResponse(session),
      envelope
    };
  });

  app.post("/api/calls/:id/postcall", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const payload = postCallRequestSchema.parse(request.body);
    const session = store.getOrThrow(params.id);
    const envelope = buildPostCallSummary(
      session,
      payload.summary_version,
      payload.integration_targets
    );
    session.postSummary = envelope;
    store.replace(session);
    return {
      session: sessionResponse(session),
      envelope
    };
  });

  app.get("/api/calls/:id/transcript", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const session = store.getOrThrow(params.id);
    return {
      call_id: session.callId,
      state: session.state,
      transcript: session.transcript,
      turn_count: session.turnCount
    };
  });

  return app;
}

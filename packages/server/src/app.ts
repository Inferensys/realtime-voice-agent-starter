import websocket from "@fastify/websocket";
import Fastify, { FastifyInstance } from "fastify";
import { z } from "zod";
import { createProviderAdapter, knownProviders } from "@inferensys/realtime-voice-adapters";
import { loadRuntimeConfig } from "./config";
import {
  CallSession,
  callStartSchema,
  handoffRequestSchema,
  postCallRequestSchema,
  providerNameSchema,
  realtimeEventSchema
} from "@inferensys/realtime-voice";
import { DomainError, SessionStore } from "@inferensys/realtime-voice";
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
    events: [],
    toolCalls: [],
    latencyMarkers: [],
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
    events: session.events.length,
    tool_calls: session.toolCalls.length,
    latency_markers: session.latencyMarkers.length,
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
  void app.register(websocket);

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

  app.get("/healthz", async () => ({
    ok: true,
    service: "realtime-voice-agent-kit",
    handoff_timeout_seconds: config.session.handoff_timeout_seconds,
    providers: knownProviders
  }));

  app.get("/api/providers", async () => ({ providers: knownProviders }));

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

  app.post("/api/webhooks/:provider", async (request) => {
    const params = z.object({ provider: providerNameSchema }).parse(request.params);
    const body = z.record(z.unknown()).parse(request.body);
    const callId = z.string().min(1).parse(body.call_id ?? body.callId ?? body.streamSid);
    const session = store.getOrThrow(callId);
    const adapter = createProviderAdapter(params.provider);
    const normalizedEvents = adapter.normalizeProviderEvent(body, callId);

    for (const event of normalizedEvents) {
      processRealtimeEvent(session, {
        event_id: event.event_id,
        call_id: event.call_id,
        correlation_id: event.correlation_id,
        sequence: event.sequence,
        type: event.type,
        timestamp: event.timestamp,
        payload: event.payload
      });
    }

    store.replace(session);
    return {
      session: sessionResponse(session),
      events: normalizedEvents
    };
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
    session.events.push({
      event_id: envelope.event_id,
      call_id: session.callId,
      provider: "fake",
      type: "postcall.ready",
      timestamp: envelope.occurred_at,
      correlation_id: envelope.correlation_id,
      payload: { ...envelope.payload }
    });
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

  app.get("/api/calls/:id/replay", async (request) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const session = store.getOrThrow(params.id);
    return {
      call_id: session.callId,
      state: session.state,
      events: session.events,
      transcript: session.transcript,
      tool_calls: session.toolCalls,
      latency_markers: session.latencyMarkers,
      post_summary: session.postSummary ?? null
    };
  });

  app.get("/api/calls", async () => ({
    calls: store.list().map(sessionResponse)
  }));

  app.get("/api/realtime/:provider", { websocket: true }, (socket, request) => {
    const params = z.object({ provider: providerNameSchema }).parse(request.params);
    socket.on("message", (message) => {
      const receivedBytes = Array.isArray(message)
        ? message.reduce((total, chunk) => total + chunk.byteLength, 0)
        : Buffer.byteLength(message);
      socket.send(JSON.stringify({
        type: "provider.ready",
        provider: params.provider,
        received_bytes: receivedBytes
      }));
    });
  });

  return app;
}

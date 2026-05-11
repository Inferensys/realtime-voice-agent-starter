import {
  CallSession,
  HandoffRequest,
  IntegrationEventEnvelope,
  LatencyMarker,
  NormalizedVoiceEvent,
  RealtimeEventRequest,
  TranscriptPayload,
  transcriptPayloadSchema
} from "@inferensys/realtime-voice";
import { assertCondition, DomainError } from "@inferensys/realtime-voice";
import { isTerminalState, transitionOrThrow } from "@inferensys/realtime-voice";

function nowIso(): string {
  return new Date().toISOString();
}

function createEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function processRealtimeEvent(
  session: CallSession,
  event: RealtimeEventRequest
): CallSession {
  assertCondition(
    !session.seenEventIds.has(event.event_id),
    409,
    "duplicate_event",
    `Event ${event.event_id} already processed`
  );

  const effectiveCorrelationId = event.correlation_id ?? session.correlationId;
  assertCondition(
    Boolean(effectiveCorrelationId),
    400,
    "missing_correlation_id",
    "Missing correlation id in event and session context"
  );

  if (event.sequence !== undefined) {
    const prev = session.lastSequence;
    assertCondition(
      prev === undefined || event.sequence > prev,
      422,
      "invalid_sequence",
      `Out-of-order event sequence ${event.sequence}`
    );
    session.lastSequence = event.sequence;
  }

  if (event.call_id !== undefined && event.call_id !== session.callId) {
    throw new DomainError(
      400,
      "call_id_mismatch",
      `Event call_id ${event.call_id} does not match route call id ${session.callId}`
    );
  }

  if (isTerminalState(session.state)) {
    throw new DomainError(409, "call_already_terminal", `Call is already ${session.state}`);
  }

  const normalized = toNormalizedEvent(session, event, effectiveCorrelationId);

  switch (event.type) {
    case "audio.input":
    case "audio.output": {
      if (session.state === "initiated") {
        session.state = transitionOrThrow(session.state, "active");
      }
      break;
    }
    case "transcript.partial":
    case "transcript.final": {
      if (session.state === "initiated") {
        session.state = transitionOrThrow(session.state, "active");
      }
      const transcriptPayload = transcriptPayloadSchema.parse(event.payload);
      validateAssistantTurnAfterHandoff(session, transcriptPayload);
      applyTranscriptSegment(session, transcriptPayload, event);
      break;
    }
    case "tool.call": {
      applyToolCall(session, event);
      break;
    }
    case "tool.result": {
      applyToolResult(session, event);
      break;
    }
    case "turn.interrupted": {
      session.latencyMarkers.push(readLatencyMarker(event) ?? {
        name: "interruption-cancel",
        value_ms: 0
      });
      break;
    }
    case "latency.marker": {
      const marker = readLatencyMarker(event);
      if (marker) {
        session.latencyMarkers.push(marker);
      }
      break;
    }
    case "call.activated": {
      session.state = transitionOrThrow(session.state, "active");
      break;
    }
    case "call.closing": {
      session.state = transitionOrThrow(session.state, "closing");
      break;
    }
    case "call.closed": {
      session.state = transitionOrThrow(session.state, "closed");
      break;
    }
    case "call.failed": {
      session.state = transitionOrThrow(session.state, "failed");
      break;
    }
    case "handoff.accepted":
    case "call.handed_off": {
      session.state = transitionOrThrow(session.state, "handed_off");
      const payload = event.payload as {
        agent_id?: string;
        accept_time?: string;
      };
      session.handoff = {
        ...(session.handoff ?? {
          requestedBy: "unknown",
          reasonCode: "unknown",
          targetQueue: "unknown",
          lastTranscriptSeq: session.lastSequence ?? 0
        }),
        acceptedAgentId: payload.agent_id ?? "agent_unset",
        acceptedAt: payload.accept_time ?? nowIso()
      };
      break;
    }
    default:
      break;
  }

  session.updatedAt = nowIso();
  session.seenEventIds.add(event.event_id);
  session.events.push(normalized);
  if (effectiveCorrelationId) {
    session.correlationId = effectiveCorrelationId;
  }
  return session;
}

function toNormalizedEvent(
  session: CallSession,
  event: RealtimeEventRequest,
  correlationId: string | undefined
): NormalizedVoiceEvent {
  return {
    event_id: event.event_id,
    call_id: event.call_id ?? session.callId,
    provider: "fake",
    type: normalizeLegacyEventType(event.type),
    timestamp: event.timestamp,
    sequence: event.sequence,
    correlation_id: correlationId,
    payload: event.payload
  };
}

function normalizeLegacyEventType(type: string): NormalizedVoiceEvent["type"] {
  if (type === "call.handed_off") {
    return "handoff.accepted";
  }
  if (type === "call.handoff_requested") {
    return "handoff.requested";
  }
  if (type === "call.post_summary_ready") {
    return "postcall.ready";
  }
  return type as NormalizedVoiceEvent["type"];
}

function validateAssistantTurnAfterHandoff(
  session: CallSession,
  payload: TranscriptPayload
): void {
  if (session.state === "handed_off" && payload.speaker === "assistant") {
    throw new DomainError(
      409,
      "assistant_turn_forbidden_after_handoff",
      "Assistant-generated turns are forbidden after handoff completion"
    );
  }
}

function applyTranscriptSegment(
  session: CallSession,
  payload: TranscriptPayload,
  event: RealtimeEventRequest
): void {
  const sequence = event.sequence ?? session.transcript.length + 1;
  const segment = {
    sequence,
    speaker: payload.speaker,
    text: payload.text,
    isFinal: payload.is_final ?? event.type === "transcript.final",
    timestamp: event.timestamp
  };
  if (payload.confidence !== undefined) {
    session.transcript.push({ ...segment, confidence: payload.confidence });
    session.turnCount += 1;
    return;
  }
  session.transcript.push(segment);
  session.turnCount += 1;
}

function applyToolCall(session: CallSession, event: RealtimeEventRequest): void {
  const payload = event.payload as {
    tool_call_id?: string;
    tool_name?: string;
    arguments?: Record<string, unknown>;
  };
  session.toolCalls.push({
    callId: session.callId,
    toolCallId: payload.tool_call_id ?? event.event_id,
    toolName: payload.tool_name ?? "unknown_tool",
    arguments: payload.arguments ?? {},
    status: "requested",
    timestamp: event.timestamp
  });
}

function applyToolResult(session: CallSession, event: RealtimeEventRequest): void {
  const payload = event.payload as {
    tool_call_id?: string;
    result?: unknown;
    error?: string;
  };
  const toolCallId = payload.tool_call_id ?? event.event_id;
  const existing = session.toolCalls.find((call) => call.toolCallId === toolCallId);
  if (!existing) {
    const nextCall = {
      callId: session.callId,
      toolCallId,
      toolName: "unknown_tool",
      arguments: {},
      status: payload.error ? "failed" : "completed",
      timestamp: event.timestamp
    } as const;
    session.toolCalls.push({
      ...nextCall,
      ...(payload.result !== undefined ? { result: payload.result } : {}),
      ...(payload.error !== undefined ? { error: payload.error } : {})
    });
    return;
  }
  existing.status = payload.error ? "failed" : "completed";
  if (payload.result !== undefined) {
    existing.result = payload.result;
  }
  if (payload.error !== undefined) {
    existing.error = payload.error;
  }
}

function readLatencyMarker(event: RealtimeEventRequest): LatencyMarker | undefined {
  const payload = event.payload as {
    name?: LatencyMarker["name"];
    value_ms?: number;
    budget_ms?: number;
  };
  if (!payload.name || typeof payload.value_ms !== "number") {
    return undefined;
  }
  return {
    name: payload.name,
    value_ms: payload.value_ms,
    budget_ms: payload.budget_ms
  };
}

export function requestHandoff(
  session: CallSession,
  request: HandoffRequest
): IntegrationEventEnvelope<{
  requested_by: string;
  reason_code: string;
  last_transcript_seq: number;
  target_queue: string;
}> {
  assertCondition(
    session.allowHandoff,
    403,
    "handoff_not_allowed",
    "Call capability disallows handoff"
  );
  assertCondition(
    !session.seenEventIds.has(request.event_id),
    409,
    "duplicate_event",
    `Event ${request.event_id} already processed`
  );

  const effectiveCorrelationId = request.correlation_id ?? session.correlationId;
  assertCondition(
    Boolean(effectiveCorrelationId),
    400,
    "missing_correlation_id",
    "Missing correlation id in handoff request and session context"
  );

  const targetSeq = request.payload.last_transcript_seq;
  if (session.lastSequence !== undefined) {
    assertCondition(
      targetSeq <= session.lastSequence,
      422,
      "invalid_sequence",
      `Handoff pointer ${targetSeq} exceeds last sequence ${session.lastSequence}`
    );
  }

  if (session.state === "active") {
    session.state = transitionOrThrow(session.state, "escalated");
  }
  session.state = transitionOrThrow(session.state, "handoff_pending");

  const handoff = {
    requestedBy: request.payload.requested_by,
    reasonCode: request.payload.reason_code,
    targetQueue: request.payload.target_queue,
    lastTranscriptSeq: request.payload.last_transcript_seq
  };
  if (request.payload.context_snapshot_uri !== undefined) {
    session.handoff = {
      ...handoff,
      contextSnapshotUri: request.payload.context_snapshot_uri
    };
  } else {
    session.handoff = handoff;
  }
  if (effectiveCorrelationId) {
    session.correlationId = effectiveCorrelationId;
  }
  session.updatedAt = nowIso();
  session.seenEventIds.add(request.event_id);
  session.events.push({
    event_id: request.event_id,
    call_id: session.callId,
    provider: "fake",
    type: "handoff.requested",
    timestamp: request.timestamp,
    ...(effectiveCorrelationId ? { correlation_id: effectiveCorrelationId } : {}),
    payload: request.payload
  });

  return {
    event_id: createEventId("evt_handoff_requested"),
    event_type: "handoff.requested",
    occurred_at: nowIso(),
    call_id: session.callId,
    correlation_id: effectiveCorrelationId ?? "corr_unset",
    payload: {
      requested_by: request.payload.requested_by,
      reason_code: request.payload.reason_code,
      last_transcript_seq: request.payload.last_transcript_seq,
      target_queue: request.payload.target_queue
    }
  };
}

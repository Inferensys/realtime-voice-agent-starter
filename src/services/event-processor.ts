import {
  CallSession,
  HandoffRequest,
  IntegrationEventEnvelope,
  RealtimeEventRequest,
  TranscriptPayload,
  transcriptPayloadSchema
} from "../contracts";
import { assertCondition, DomainError } from "../domain/errors";
import { isTerminalState, transitionOrThrow } from "../domain/state-machine";

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

  switch (event.type) {
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
  if (effectiveCorrelationId) {
    session.correlationId = effectiveCorrelationId;
  }
  return session;
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

  return {
    event_id: createEventId("evt_handoff_requested"),
    event_type: "call.handoff_requested",
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

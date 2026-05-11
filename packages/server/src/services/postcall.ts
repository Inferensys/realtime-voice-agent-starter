import {
  CallSession,
  IntegrationEventEnvelope,
  PostSummaryPayload
} from "@inferensys/realtime-voice";
import { DomainError } from "@inferensys/realtime-voice";

function nowIso(): string {
  return new Date().toISOString();
}

function createEventId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPostCallSummary(
  session: CallSession,
  summaryVersion: string,
  integrationTargets: string[]
): IntegrationEventEnvelope<PostSummaryPayload> {
  if (session.state !== "closed") {
    throw new DomainError(
      409,
      "postcall_requires_closed",
      "post_call_summary can only emit after call is closed"
    );
  }

  const finalSegments = session.transcript.filter((segment) => segment.isFinal);
  const summaryText =
    finalSegments.length > 0
      ? finalSegments
          .slice(Math.max(0, finalSegments.length - 3))
          .map((segment) => `${segment.speaker}: ${segment.text}`)
          .join(" | ")
      : "No final transcript segments were committed for this call.";

  const finalDisposition =
    session.handoff?.acceptedAgentId !== undefined
      ? "handed_off_completed"
      : "auto_resolved";

  return {
    event_id: createEventId("evt_post_summary"),
    event_type: "postcall.ready",
    occurred_at: nowIso(),
    call_id: session.callId,
    correlation_id: session.correlationId ?? "corr_unset",
    payload: {
      summary_version: summaryVersion,
      summary_text: summaryText,
      final_disposition: finalDisposition,
      action_items:
        finalDisposition === "handed_off_completed"
          ? ["Assigned human agent should close follow-up actions in downstream CRM."]
          : ["No handoff occurred; verify autonomous resolution and disposition tagging."],
      integration_targets: integrationTargets
    }
  };
}

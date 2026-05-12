import { z } from "zod";
import { SessionState } from "./state-machine";

export const speakerSchema = z.enum(["caller", "assistant", "agent", "system"]);

export const providerNameSchema = z.enum([
  "fake",
  "openai-realtime",
  "azure-openai-realtime",
  "gemini-live",
  "twilio-media-streams",
  "livekit",
  "deepgram",
  "elevenlabs",
  "cartesia",
  "assemblyai"
]);

export type ProviderName = z.infer<typeof providerNameSchema>;

export const normalizedEventTypeSchema = z.enum([
  "audio.input",
  "audio.output",
  "transcript.partial",
  "transcript.final",
  "tool.call",
  "tool.result",
  "turn.interrupted",
  "handoff.requested",
  "handoff.accepted",
  "call.activated",
  "call.closing",
  "call.closed",
  "call.failed",
  "postcall.ready",
  "latency.marker"
]);

export type NormalizedEventType = z.infer<typeof normalizedEventTypeSchema>;

export const latencyMarkerNameSchema = z.enum([
  "first-token",
  "first-audio",
  "user-stop-to-agent-start",
  "interruption-cancel",
  "handoff-latency"
]);

export type LatencyMarkerName = z.infer<typeof latencyMarkerNameSchema>;

export const latencyMarkerSchema = z.object({
  name: latencyMarkerNameSchema,
  value_ms: z.number().nonnegative(),
  budget_ms: z.number().positive().optional()
});

export type LatencyMarker = z.infer<typeof latencyMarkerSchema>;

export const normalizedVoiceEventSchema = z.object({
  event_id: z.string().min(1),
  call_id: z.string().min(1),
  provider: providerNameSchema,
  type: normalizedEventTypeSchema,
  timestamp: z.string().datetime(),
  sequence: z.number().int().positive().optional(),
  correlation_id: z.string().min(1).optional(),
  payload: z.record(z.unknown()).default({})
});

export type NormalizedVoiceEvent = z.infer<typeof normalizedVoiceEventSchema>;

export const callStartSchema = z.object({
  call_id: z.string().min(1),
  source: z.string().min(1),
  caller: z.object({
    phone_e164: z.string().min(1),
    locale: z.string().min(1)
  }),
  context: z.object({
    tenant: z.string().min(1),
    queue: z.string().min(1),
    request_id: z.string().min(1).optional()
  }),
  capabilities: z.object({
    allow_handoff: z.boolean(),
    allow_tool_calls: z.boolean()
  })
});

export const realtimeEventSchema = z.object({
  event_id: z.string().min(1),
  call_id: z.string().min(1).optional(),
  provider: providerNameSchema.optional(),
  correlation_id: z.string().min(1).optional(),
  sequence: z.number().int().positive().optional(),
  type: normalizedEventTypeSchema.or(z.string().min(1)),
  timestamp: z.string().datetime(),
  payload: z.record(z.unknown())
});

export const handoffRequestSchema = z.object({
  event_id: z.string().min(1),
  correlation_id: z.string().min(1).optional(),
  type: z.literal("call.handoff_requested").or(z.literal("handoff.requested")),
  timestamp: z.string().datetime(),
  payload: z.object({
    requested_by: z.string().min(1),
    reason_code: z.string().min(1),
    target_queue: z.string().min(1),
    last_transcript_seq: z.number().int().nonnegative(),
    context_snapshot_uri: z.string().min(1).optional()
  })
});

export const postCallRequestSchema = z.object({
  summary_version: z.string().min(1).default("v1"),
  integration_targets: z.array(z.string().min(1)).default(["crm", "ticketing"])
});

export const transcriptPayloadSchema = z.object({
  speaker: speakerSchema,
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  is_final: z.boolean().optional()
});

export type CallStartRequest = z.infer<typeof callStartSchema>;
export type RealtimeEventRequest = z.infer<typeof realtimeEventSchema>;
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
export type PostCallRequest = z.infer<typeof postCallRequestSchema>;
export type TranscriptPayload = z.infer<typeof transcriptPayloadSchema>;

export interface TranscriptSegment {
  sequence: number;
  speaker: TranscriptPayload["speaker"];
  text: string;
  confidence?: number;
  isFinal: boolean;
  timestamp: string;
}

export interface ToolCallEvent {
  callId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "requested" | "completed" | "failed";
  result?: unknown;
  error?: string;
  timestamp: string;
}

export interface HandoffDetails {
  requestedBy: string;
  reasonCode: string;
  targetQueue: string;
  lastTranscriptSeq: number;
  contextSnapshotUri?: string;
  acceptedAgentId?: string;
  acceptedAt?: string;
}

export interface IntegrationEventEnvelope<TPayload> {
  event_id: string;
  event_type: string;
  occurred_at: string;
  call_id: string;
  correlation_id: string;
  payload: TPayload;
}

export interface PostSummaryPayload {
  summary_version: string;
  summary_text: string;
  final_disposition: string;
  action_items: string[];
  integration_targets: string[];
}

export interface CallSession {
  callId: string;
  source: string;
  callerPhone: string;
  callerLocale: string;
  tenant: string;
  queue: string;
  state: SessionState;
  correlationId?: string;
  allowHandoff: boolean;
  allowToolCalls: boolean;
  createdAt: string;
  updatedAt: string;
  lastSequence?: number;
  turnCount: number;
  transcript: TranscriptSegment[];
  events: NormalizedVoiceEvent[];
  toolCalls: ToolCallEvent[];
  latencyMarkers: LatencyMarker[];
  handoff?: HandoffDetails;
  seenEventIds: Set<string>;
  postSummary?: IntegrationEventEnvelope<PostSummaryPayload>;
}

export type ToolSchema = Record<string, "string" | "number" | "boolean" | "object" | "array">;

export interface VoiceTool<TArgs extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description?: string;
  schema: ToolSchema;
  handler: (args: TArgs) => Promise<unknown> | unknown;
}

export interface VoiceAgentDefinition {
  name: string;
  instructions: string;
  tools?: VoiceTool[];
  handoff?: {
    enabled: boolean;
    queues: string[];
  };
}

export interface RealtimeTransport {
  name: string;
  connect(session: CallSession): Promise<void>;
  sendAudio?(session: CallSession, chunk: Uint8Array): Promise<void>;
  close(session: CallSession): Promise<void>;
}

export interface SpeechModelAdapter {
  provider: ProviderName;
  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[];
}

export interface STTAdapter extends SpeechModelAdapter {
  kind: "stt";
}

export interface TTSAdapter extends SpeechModelAdapter {
  kind: "tts";
  synthesize?(text: string): AsyncIterable<Uint8Array>;
}

export interface EventSink {
  publish(event: NormalizedVoiceEvent): Promise<void> | void;
}

export interface TranscriptStore {
  append(callId: string, segment: TranscriptSegment): Promise<void> | void;
  list(callId: string): Promise<TranscriptSegment[]> | TranscriptSegment[];
}

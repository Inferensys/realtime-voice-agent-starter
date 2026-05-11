import {
  NormalizedVoiceEvent,
  ProviderName,
  SpeechModelAdapter
} from "@inferensys/realtime-voice";

export const knownProviders: ProviderName[] = [
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
];

type RawRecord = Record<string, unknown>;

function asRecord(raw: unknown): RawRecord {
  return raw !== null && typeof raw === "object" ? raw as RawRecord : {};
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function event(
  provider: ProviderName,
  callId: string,
  type: NormalizedVoiceEvent["type"],
  payload: RawRecord,
  options: {
    eventId?: string;
    timestamp?: string;
    sequence?: number;
    correlationId?: string;
  } = {}
): NormalizedVoiceEvent {
  const normalized: NormalizedVoiceEvent = {
    event_id: options.eventId ?? `${provider}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    call_id: callId,
    provider,
    type,
    timestamp: options.timestamp ?? nowIso(),
    payload
  };
  if (options.sequence !== undefined) {
    normalized.sequence = options.sequence;
  }
  if (options.correlationId !== undefined) {
    normalized.correlation_id = options.correlationId;
  }
  return normalized;
}

abstract class MappingAdapter implements SpeechModelAdapter {
  constructor(readonly provider: ProviderName) {}

  abstract normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[];

  protected makeEvent(
    callId: string,
    type: NormalizedVoiceEvent["type"],
    payload: RawRecord,
    options?: Parameters<typeof event>[4]
  ): NormalizedVoiceEvent {
    return event(this.provider, callId, type, payload, options);
  }
}

class FakeAdapter extends MappingAdapter {
  constructor() {
    super("fake");
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const type = str(body.type, "call.activated") as NormalizedVoiceEvent["type"];
    const options: Parameters<typeof event>[4] = {
      eventId: str(body.event_id, `fake_${Date.now()}`),
      timestamp: str(body.timestamp, nowIso())
    };
    if (typeof body.sequence === "number") {
      options.sequence = body.sequence;
    }
    if (typeof body.correlation_id === "string") {
      options.correlationId = body.correlation_id;
    }
    return [
      this.makeEvent(callId, type, asRecord(body.payload), options)
    ];
  }
}

class TwilioMediaStreamsAdapter extends MappingAdapter {
  constructor() {
    super("twilio-media-streams");
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const streamSid = str(body.streamSid, str(body.stream_sid, "stream_unset"));
    const eventName = str(body.event, "");
    if (eventName === "start") {
      return [this.makeEvent(callId, "call.activated", { stream_sid: streamSid, start: asRecord(body.start) })];
    }
    if (eventName === "media") {
      return [this.makeEvent(callId, "audio.input", { stream_sid: streamSid, media: asRecord(body.media) })];
    }
    if (eventName === "mark") {
      return [this.makeEvent(callId, "latency.marker", { name: "first-audio", value_ms: 0, mark: asRecord(body.mark) })];
    }
    if (eventName === "stop") {
      return [this.makeEvent(callId, "call.closed", { stream_sid: streamSid, stop: asRecord(body.stop) })];
    }
    return [this.makeEvent(callId, "audio.input", { stream_sid: streamSid, raw: body })];
  }
}

class OpenAIRealtimeAdapter extends MappingAdapter {
  constructor(provider: Extract<ProviderName, "openai-realtime" | "azure-openai-realtime"> = "openai-realtime") {
    super(provider);
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const type = str(body.type, "");
    if (type.includes("input_audio_transcription") && type.includes("completed")) {
      return [this.makeEvent(callId, "transcript.final", {
        speaker: "caller",
        text: str(body.transcript, ""),
        is_final: true
      })];
    }
    if (type === "response.audio.delta") {
      return [this.makeEvent(callId, "audio.output", { delta: body.delta ?? "" })];
    }
    if (type === "response.audio_transcript.delta") {
      return [this.makeEvent(callId, "transcript.partial", {
        speaker: "assistant",
        text: str(body.delta, ""),
        is_final: false
      })];
    }
    if (type === "response.function_call_arguments.done") {
      return [this.makeEvent(callId, "tool.call", {
        tool_call_id: str(body.call_id, str(body.item_id, "tool_call_unset")),
        tool_name: str(body.name, "unknown_tool"),
        arguments: body.arguments ?? {}
      })];
    }
    if (type === "input_audio_buffer.speech_started") {
      return [this.makeEvent(callId, "turn.interrupted", { name: "interruption-cancel", value_ms: 0 })];
    }
    return [this.makeEvent(callId, "audio.input", { raw: body })];
  }
}

class GeminiLiveAdapter extends MappingAdapter {
  constructor() {
    super("gemini-live");
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const serverContent = asRecord(body.serverContent);
    const inputTranscript = asRecord(serverContent.inputTranscription);
    const outputTranscript = asRecord(serverContent.outputTranscription);
    if (inputTranscript.text) {
      return [this.makeEvent(callId, "transcript.final", {
        speaker: "caller",
        text: str(inputTranscript.text, ""),
        is_final: true
      })];
    }
    if (outputTranscript.text) {
      return [this.makeEvent(callId, "transcript.partial", {
        speaker: "assistant",
        text: str(outputTranscript.text, ""),
        is_final: false
      })];
    }
    if (serverContent.interrupted === true) {
      return [this.makeEvent(callId, "turn.interrupted", { name: "interruption-cancel", value_ms: 0 })];
    }
    return [this.makeEvent(callId, "audio.output", { raw: body })];
  }
}

class LiveKitAdapter extends MappingAdapter {
  constructor() {
    super("livekit");
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const eventName = str(body.event, str(body.type, ""));
    if (eventName.includes("transcript")) {
      return [this.makeEvent(callId, bool(body.is_final, false) ? "transcript.final" : "transcript.partial", {
        speaker: str(body.speaker, "caller"),
        text: str(body.text, ""),
        is_final: bool(body.is_final, false)
      })];
    }
    if (eventName.includes("handoff")) {
      return [this.makeEvent(callId, "handoff.requested", { raw: body })];
    }
    return [this.makeEvent(callId, "audio.input", { raw: body })];
  }
}

class DeepgramAdapter extends MappingAdapter {
  constructor() {
    super("deepgram");
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const channel = asRecord(body.channel);
    const alternatives = Array.isArray(channel.alternatives) ? channel.alternatives : [];
    const first = asRecord(alternatives[0]);
    const transcript = str(first.transcript, str(body.transcript, ""));
    return [this.makeEvent(callId, bool(body.is_final, false) ? "transcript.final" : "transcript.partial", {
      speaker: "caller",
      text: transcript,
      confidence: typeof first.confidence === "number" ? first.confidence : undefined,
      is_final: bool(body.is_final, false)
    })];
  }
}

class ElevenLabsAdapter extends MappingAdapter {
  constructor() {
    super("elevenlabs");
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const eventName = str(body.type, str(body.event, ""));
    if (eventName.includes("user_transcript")) {
      return [this.makeEvent(callId, "transcript.final", {
        speaker: "caller",
        text: str(body.user_transcript, str(body.text, "")),
        is_final: true
      })];
    }
    if (eventName.includes("agent_response")) {
      return [this.makeEvent(callId, "transcript.final", {
        speaker: "assistant",
        text: str(body.agent_response, str(body.text, "")),
        is_final: true
      })];
    }
    if (eventName.includes("audio")) {
      return [this.makeEvent(callId, "audio.output", { audio: body.audio ?? body.audio_event ?? "" })];
    }
    return [this.makeEvent(callId, "audio.output", { raw: body })];
  }
}

class CartesiaAdapter extends MappingAdapter {
  constructor() {
    super("cartesia");
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const eventName = str(body.type, str(body.status, ""));
    if (eventName === "chunk" || body.data !== undefined || body.audio !== undefined) {
      return [this.makeEvent(callId, "audio.output", { audio: body.data ?? body.audio ?? "" })];
    }
    if (eventName === "done") {
      return [this.makeEvent(callId, "latency.marker", { name: "first-audio", value_ms: 0 })];
    }
    return [this.makeEvent(callId, "audio.output", { raw: body })];
  }
}

class AssemblyAIAdapter extends MappingAdapter {
  constructor() {
    super("assemblyai");
  }

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    const body = asRecord(raw);
    const transcript = str(body.text, str(body.transcript, ""));
    const isFinal = bool(body.end_of_turn, bool(body.message_type === "FinalTranscript", false));
    return [this.makeEvent(callId, isFinal ? "transcript.final" : "transcript.partial", {
      speaker: "caller",
      text: transcript,
      is_final: isFinal,
      redacted: body.redacted ?? undefined
    })];
  }
}

export function createProviderAdapter(provider: ProviderName): SpeechModelAdapter {
  switch (provider) {
    case "fake":
      return new FakeAdapter();
    case "openai-realtime":
      return new OpenAIRealtimeAdapter("openai-realtime");
    case "azure-openai-realtime":
      return new OpenAIRealtimeAdapter("azure-openai-realtime");
    case "gemini-live":
      return new GeminiLiveAdapter();
    case "twilio-media-streams":
      return new TwilioMediaStreamsAdapter();
    case "livekit":
      return new LiveKitAdapter();
    case "deepgram":
      return new DeepgramAdapter();
    case "elevenlabs":
      return new ElevenLabsAdapter();
    case "cartesia":
      return new CartesiaAdapter();
    case "assemblyai":
      return new AssemblyAIAdapter();
    default:
      return new FakeAdapter();
  }
}

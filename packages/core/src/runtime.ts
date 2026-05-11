import {
  EventSink,
  RealtimeTransport,
  SpeechModelAdapter,
  VoiceAgentDefinition,
  VoiceTool
} from "./contracts";

export type TurnPolicyName = "strict" | "interruptible" | "push-to-talk";
export type StoreKind = "memory" | "sqlite" | "postgres";

export interface VoiceRuntimeOptions {
  agent: VoiceAgentDefinition;
  transport: RealtimeTransport | string;
  model: SpeechModelAdapter | string;
  turnPolicy?: TurnPolicyName;
  store?: StoreKind;
  eventSink?: EventSink;
}

export interface VoiceRuntime {
  agent: VoiceAgentDefinition;
  transport: RealtimeTransport | string;
  model: SpeechModelAdapter | string;
  turnPolicy: TurnPolicyName;
  store: StoreKind;
  eventSink?: EventSink;
}

export function defineAgent(definition: VoiceAgentDefinition): VoiceAgentDefinition {
  return {
    ...definition,
    tools: definition.tools ?? []
  };
}

export function defineTool<TArgs extends Record<string, unknown>>(
  tool: VoiceTool<TArgs>
): VoiceTool<TArgs> {
  return tool;
}

export function createVoiceRuntime(options: VoiceRuntimeOptions): VoiceRuntime {
  const runtime: VoiceRuntime = {
    agent: options.agent,
    transport: options.transport,
    model: options.model,
    turnPolicy: options.turnPolicy ?? "interruptible",
    store: options.store ?? "memory"
  };
  if (options.eventSink !== undefined) {
    runtime.eventSink = options.eventSink;
  }
  return runtime;
}

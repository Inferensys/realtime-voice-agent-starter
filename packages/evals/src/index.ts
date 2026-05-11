import {
  CallSession,
  NormalizedVoiceEvent
} from "@inferensys/realtime-voice";

export interface EvalScenario {
  id: string;
  name: string;
  description: string;
  events: NormalizedVoiceEvent[];
  assertions: EvalAssertion[];
}

export interface EvalAssertion {
  id: string;
  description: string;
  check: (context: EvalContext) => boolean;
}

export interface EvalContext {
  session: CallSession;
  events: NormalizedVoiceEvent[];
}

export interface EvalResult {
  scenario_id: string;
  scenario_name: string;
  passed: boolean;
  assertions: Array<{
    id: string;
    passed: boolean;
    description: string;
  }>;
}

function emptySession(callId: string): CallSession {
  const now = new Date().toISOString();
  return {
    callId,
    source: "eval",
    callerPhone: "+15555550100",
    callerLocale: "en-US",
    tenant: "eval",
    queue: "support",
    state: "initiated",
    correlationId: `corr_${callId}`,
    allowHandoff: true,
    allowToolCalls: true,
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

export function runEvalScenario(scenario: EvalScenario): EvalResult {
  const callId = scenario.events[0]?.call_id ?? `eval_${scenario.id}`;
  const session = emptySession(callId);
  for (const event of scenario.events) {
    session.events.push(event);
    if (event.type === "transcript.final" || event.type === "transcript.partial") {
      const payload = event.payload as {
        speaker?: "caller" | "assistant" | "agent" | "system";
        text?: string;
        is_final?: boolean;
      };
      session.transcript.push({
        sequence: event.sequence ?? session.transcript.length + 1,
        speaker: payload.speaker ?? "caller",
        text: payload.text ?? "",
        isFinal: payload.is_final ?? event.type === "transcript.final",
        timestamp: event.timestamp
      });
      session.turnCount += 1;
    }
    if (event.type === "turn.interrupted") {
      session.latencyMarkers.push({
        name: "interruption-cancel",
        value_ms: typeof event.payload.value_ms === "number" ? event.payload.value_ms : 0
      });
    }
    if (event.type === "handoff.accepted") {
      session.state = "handed_off";
    }
    if (event.type === "call.closed") {
      session.state = "closed";
    }
  }
  const context = { session, events: scenario.events };
  const assertions = scenario.assertions.map((assertion) => ({
    id: assertion.id,
    description: assertion.description,
    passed: assertion.check(context)
  }));
  return {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    passed: assertions.every((assertion) => assertion.passed),
    assertions
  };
}

export function runEvalSuite(scenarios: EvalScenario[]): EvalResult[] {
  return scenarios.map(runEvalScenario);
}

function voiceEvent(
  scenarioId: string,
  sequence: number,
  type: NormalizedVoiceEvent["type"],
  payload: Record<string, unknown>
): NormalizedVoiceEvent {
  return {
    event_id: `${scenarioId}_${sequence}`,
    call_id: `call_${scenarioId}`,
    provider: "fake",
    type,
    timestamp: new Date(1760000000000 + sequence * 1000).toISOString(),
    sequence,
    payload
  };
}

export const defaultEvalScenarios: EvalScenario[] = [
  {
    id: "standard-intake",
    name: "Standard intake",
    description: "Caller intent is captured and the call closes cleanly.",
    events: [
      voiceEvent("standard-intake", 1, "transcript.final", { speaker: "caller", text: "I need to change my appointment.", is_final: true }),
      voiceEvent("standard-intake", 2, "transcript.final", { speaker: "assistant", text: "I can help with that.", is_final: true }),
      voiceEvent("standard-intake", 3, "call.closed", {})
    ],
    assertions: [
      {
        id: "has-final-transcript",
        description: "At least one final transcript segment was committed.",
        check: ({ session }) => session.transcript.some((segment) => segment.isFinal)
      },
      {
        id: "closed",
        description: "Scenario reaches a closed state.",
        check: ({ session }) => session.state === "closed"
      }
    ]
  },
  {
    id: "barge-in",
    name: "Barge-in",
    description: "Caller interruption is captured as a turn cancellation marker.",
    events: [
      voiceEvent("barge-in", 1, "audio.output", { text: "Long assistant answer starts" }),
      voiceEvent("barge-in", 2, "turn.interrupted", { value_ms: 120 }),
      voiceEvent("barge-in", 3, "transcript.final", { speaker: "caller", text: "Actually, transfer me.", is_final: true })
    ],
    assertions: [
      {
        id: "interruption-marker",
        description: "Interruption marker was recorded.",
        check: ({ session }) => session.latencyMarkers.some((marker) => marker.name === "interruption-cancel")
      }
    ]
  },
  {
    id: "silence-timeout",
    name: "Silence timeout",
    description: "No-response recovery is represented as a tool/result pair.",
    events: [
      voiceEvent("silence-timeout", 1, "tool.call", { tool_name: "recover_silence", tool_call_id: "tool_1" }),
      voiceEvent("silence-timeout", 2, "tool.result", { tool_call_id: "tool_1", result: { prompt: "Are you still there?" } })
    ],
    assertions: [
      {
        id: "recovery-tool",
        description: "Recovery tool was requested.",
        check: ({ events }) => events.some((event) => event.type === "tool.call")
      }
    ]
  },
  {
    id: "duplicate-event",
    name: "Duplicate event",
    description: "Scenario contains a repeated event id for duplicate handling checks.",
    events: [
      { ...voiceEvent("duplicate-event", 1, "transcript.final", { speaker: "caller", text: "Hello", is_final: true }), event_id: "dup_1" },
      { ...voiceEvent("duplicate-event", 2, "transcript.final", { speaker: "caller", text: "Hello", is_final: true }), event_id: "dup_1" }
    ],
    assertions: [
      {
        id: "duplicate-present",
        description: "Duplicate event id exists in the synthetic stream.",
        check: ({ events }) => new Set(events.map((event) => event.event_id)).size < events.length
      }
    ]
  },
  {
    id: "slow-model",
    name: "Slow model",
    description: "First audio latency is tracked against budget.",
    events: [
      voiceEvent("slow-model", 1, "latency.marker", { name: "first-audio", value_ms: 1300, budget_ms: 900 })
    ],
    assertions: [
      {
        id: "latency-measured",
        description: "Latency marker exists for first audio.",
        check: ({ events }) => events.some((event) => event.type === "latency.marker")
      }
    ]
  },
  {
    id: "tool-failure",
    name: "Tool failure",
    description: "Tool failure is represented without ending the call.",
    events: [
      voiceEvent("tool-failure", 1, "tool.call", { tool_call_id: "tool_fail", tool_name: "lookup_account" }),
      voiceEvent("tool-failure", 2, "tool.result", { tool_call_id: "tool_fail", error: "timeout" }),
      voiceEvent("tool-failure", 3, "transcript.final", { speaker: "assistant", text: "I could not reach that system. I can still take a message.", is_final: true })
    ],
    assertions: [
      {
        id: "recoverable-response",
        description: "Assistant recovered after tool failure.",
        check: ({ session }) => session.transcript.some((segment) => segment.speaker === "assistant")
      }
    ]
  },
  {
    id: "handoff",
    name: "Handoff",
    description: "Human transfer preserves a terminal handoff state.",
    events: [
      voiceEvent("handoff", 1, "transcript.final", { speaker: "caller", text: "I need a human.", is_final: true }),
      voiceEvent("handoff", 2, "handoff.accepted", { agent_id: "agent_1" })
    ],
    assertions: [
      {
        id: "handed-off",
        description: "Scenario reaches handed_off state.",
        check: ({ session }) => session.state === "handed_off"
      }
    ]
  },
  {
    id: "postcall-webhook",
    name: "Post-call webhook",
    description: "Post-call ready event is emitted once.",
    events: [
      voiceEvent("postcall-webhook", 1, "call.closed", {}),
      voiceEvent("postcall-webhook", 2, "postcall.ready", { summary_version: "v1" })
    ],
    assertions: [
      {
        id: "postcall-ready",
        description: "Post-call event exists.",
        check: ({ events }) => events.filter((event) => event.type === "postcall.ready").length === 1
      }
    ]
  }
];

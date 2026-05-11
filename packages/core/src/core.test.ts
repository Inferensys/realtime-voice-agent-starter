import { describe, expect, it } from "vitest";
import {
  canTransition,
  createVoiceRuntime,
  defineAgent,
  defineTool,
  SessionStore
} from "./index";

describe("core runtime contracts", () => {
  it("keeps the canonical state machine strict", () => {
    expect(canTransition("initiated", "active")).toBe(true);
    expect(canTransition("closed", "active")).toBe(false);
  });

  it("builds a reusable voice runtime definition", () => {
    const tool = defineTool({
      name: "lookup_order",
      schema: { orderId: "string" },
      handler: async ({ orderId }) => ({ orderId, status: "shipped" })
    });
    const agent = defineAgent({
      name: "support-agent",
      instructions: "Resolve the caller's issue or transfer to a human.",
      tools: [tool],
      handoff: {
        enabled: true,
        queues: ["support-specialist"]
      }
    });
    const runtime = createVoiceRuntime({
      agent,
      transport: "twilio-media-streams",
      model: "openai-realtime"
    });
    expect(runtime.turnPolicy).toBe("interruptible");
    expect(runtime.agent.tools).toHaveLength(1);
  });

  it("stores sessions and event replay data", () => {
    const store = new SessionStore();
    const now = new Date().toISOString();
    store.create({
      callId: "call_test",
      source: "test",
      callerPhone: "+15555550100",
      callerLocale: "en-US",
      tenant: "test",
      queue: "support",
      state: "initiated",
      correlationId: "corr_test",
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
    });
    store.appendEvent("call_test", {
      event_id: "evt_1",
      call_id: "call_test",
      provider: "fake",
      type: "call.activated",
      timestamp: now,
      payload: {}
    });
    expect(store.listEvents("call_test")).toHaveLength(1);
  });
});

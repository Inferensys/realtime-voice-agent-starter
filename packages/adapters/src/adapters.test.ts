import { describe, expect, it } from "vitest";
import { createProviderAdapter, knownProviders } from "./index";

describe("provider adapters", () => {
  it("registers the launch provider set", () => {
    expect(knownProviders).toContain("openai-realtime");
    expect(knownProviders).toContain("twilio-media-streams");
    expect(knownProviders).toContain("deepgram");
    expect(knownProviders).toContain("assemblyai");
  });

  it("maps Twilio media events into normalized audio events", () => {
    const adapter = createProviderAdapter("twilio-media-streams");
    const events = adapter.normalizeProviderEvent({
      event: "media",
      streamSid: "call_twilio",
      media: {
        payload: "base64-audio"
      }
    }, "call_twilio");
    expect(events[0]?.type).toBe("audio.input");
    expect(events[0]?.provider).toBe("twilio-media-streams");
  });

  it("maps realtime model tool calls into provider-neutral tool events", () => {
    const adapter = createProviderAdapter("openai-realtime");
    const events = adapter.normalizeProviderEvent({
      type: "response.function_call_arguments.done",
      call_id: "tool_1",
      name: "lookup_order",
      arguments: "{\"orderId\":\"A1\"}"
    }, "call_openai");
    expect(events[0]?.type).toBe("tool.call");
    expect(events[0]?.payload.tool_name).toBe("lookup_order");
  });
});

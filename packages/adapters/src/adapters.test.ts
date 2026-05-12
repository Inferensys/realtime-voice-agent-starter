import { describe, expect, it } from "vitest";
import { buildAzureRealtimeWebSocketUrl, createProviderAdapter, knownProviders } from "./index";

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
    expect(events[0]?.payload.arguments).toEqual({ orderId: "A1" });
  });

  it("maps current realtime audio transcript and output events", () => {
    const adapter = createProviderAdapter("azure-openai-realtime");
    const transcriptEvents = adapter.normalizeProviderEvent({
      type: "response.output_audio_transcript.done",
      transcript: "I can help with that."
    }, "call_azure");
    const audioEvents = adapter.normalizeProviderEvent({
      type: "response.output_audio.delta",
      delta: "base64-audio"
    }, "call_azure");

    expect(transcriptEvents[0]?.type).toBe("transcript.final");
    expect(transcriptEvents[0]?.payload.text).toBe("I can help with that.");
    expect(audioEvents[0]?.type).toBe("audio.output");
    expect(audioEvents[0]?.provider).toBe("azure-openai-realtime");
  });

  it("builds the Azure GA realtime WebSocket URL from a v1 endpoint", () => {
    expect(buildAzureRealtimeWebSocketUrl({
      endpoint: "https://example.services.ai.azure.com/openai/v1",
      deployment: "gpt-realtime-1.5"
    })).toBe("wss://example.services.ai.azure.com/openai/v1/realtime?model=gpt-realtime-1.5");
  });
});

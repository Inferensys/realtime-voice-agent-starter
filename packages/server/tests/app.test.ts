import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { createApp } from "../src/app";

describe("voice control plane", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function startCall() {
    const response = await app.inject({
      method: "POST",
      url: "/api/calls/start",
      payload: {
        call_id: "call_001",
        source: "pstn",
        caller: {
          phone_e164: "+14155550100",
          locale: "en-US"
        },
        context: {
          tenant: "acme",
          queue: "support",
          request_id: "corr_call_001"
        },
        capabilities: {
          allow_handoff: true,
          allow_tool_calls: true
        }
      }
    });
    expect(response.statusCode).toBe(201);
  }

  it("handles initiated -> active -> closing -> closed and produces postcall summary", async () => {
    await startCall();

    const transcript = await app.inject({
      method: "POST",
      url: "/api/calls/call_001/events",
      payload: {
        event_id: "evt_001",
        call_id: "call_001",
        correlation_id: "corr_call_001",
        sequence: 1,
        type: "transcript.final",
        timestamp: "2026-04-15T10:00:00Z",
        payload: {
          speaker: "caller",
          text: "I need help rotating service account credentials.",
          is_final: true
        }
      }
    });
    expect(transcript.statusCode).toBe(200);
    expect(transcript.json().state).toBe("active");

    const closing = await app.inject({
      method: "POST",
      url: "/api/calls/call_001/events",
      payload: {
        event_id: "evt_002",
        call_id: "call_001",
        correlation_id: "corr_call_001",
        sequence: 2,
        type: "call.closing",
        timestamp: "2026-04-15T10:00:05Z",
        payload: {}
      }
    });
    expect(closing.statusCode).toBe(200);

    const closed = await app.inject({
      method: "POST",
      url: "/api/calls/call_001/events",
      payload: {
        event_id: "evt_003",
        call_id: "call_001",
        correlation_id: "corr_call_001",
        sequence: 3,
        type: "call.closed",
        timestamp: "2026-04-15T10:00:08Z",
        payload: {}
      }
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().state).toBe("closed");

    const postcall = await app.inject({
      method: "POST",
      url: "/api/calls/call_001/postcall",
      payload: {
        summary_version: "v1",
        integration_targets: ["crm"]
      }
    });
    expect(postcall.statusCode).toBe(200);
    expect(postcall.json().envelope.event_type).toBe("postcall.ready");
  });

  it("rejects duplicate realtime events", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/api/calls/start",
      payload: {
        call_id: "call_002",
        source: "pstn",
        caller: {
          phone_e164: "+14155550101",
          locale: "en-US"
        },
        context: {
          tenant: "acme",
          queue: "support",
          request_id: "corr_call_002"
        },
        capabilities: {
          allow_handoff: true,
          allow_tool_calls: true
        }
      }
    });
    expect(start.statusCode).toBe(201);

    const payload = {
      event_id: "evt_dup_001",
      call_id: "call_002",
      correlation_id: "corr_call_002",
      sequence: 1,
      type: "transcript.final",
      timestamp: "2026-04-15T10:10:00Z",
      payload: {
        speaker: "caller",
        text: "Checking duplicate event handling.",
        is_final: true
      }
    };

    const first = await app.inject({ method: "POST", url: "/api/calls/call_002/events", payload });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: "POST", url: "/api/calls/call_002/events", payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("duplicate_event");
  });

  it("supports handoff and rejects assistant turns after handoff completion", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/api/calls/start",
      payload: {
        call_id: "call_003",
        source: "pstn",
        caller: {
          phone_e164: "+14155550102",
          locale: "en-US"
        },
        context: {
          tenant: "acme",
          queue: "support",
          request_id: "corr_call_003"
        },
        capabilities: {
          allow_handoff: true,
          allow_tool_calls: true
        }
      }
    });
    expect(start.statusCode).toBe(201);

    await app.inject({
      method: "POST",
      url: "/api/calls/call_003/events",
      payload: {
        event_id: "evt_handoff_preamble",
        call_id: "call_003",
        correlation_id: "corr_call_003",
        sequence: 1,
        type: "transcript.final",
        timestamp: "2026-04-15T10:20:00Z",
        payload: {
          speaker: "caller",
          text: "I need a human to handle account verification.",
          is_final: true
        }
      }
    });

    const handoff = await app.inject({
      method: "POST",
      url: "/api/calls/call_003/handoff",
      payload: {
        event_id: "evt_handoff_001",
        correlation_id: "corr_call_003",
        type: "call.handoff_requested",
        timestamp: "2026-04-15T10:20:05Z",
        payload: {
          requested_by: "voice-agent",
          reason_code: "human_verification",
          target_queue: "specialists",
          last_transcript_seq: 1
        }
      }
    });
    expect(handoff.statusCode).toBe(200);
    expect(handoff.json().session.state).toBe("handoff_pending");

    const handedOff = await app.inject({
      method: "POST",
      url: "/api/calls/call_003/events",
      payload: {
        event_id: "evt_handed_off_001",
        call_id: "call_003",
        correlation_id: "corr_call_003",
        sequence: 2,
        type: "call.handed_off",
        timestamp: "2026-04-15T10:20:08Z",
        payload: {
          agent_id: "human_001",
          accept_time: "2026-04-15T10:20:08Z"
        }
      }
    });
    expect(handedOff.statusCode).toBe(200);
    expect(handedOff.json().state).toBe("handed_off");

    const assistantAfterHandoff = await app.inject({
      method: "POST",
      url: "/api/calls/call_003/events",
      payload: {
        event_id: "evt_illegal_001",
        call_id: "call_003",
        correlation_id: "corr_call_003",
        sequence: 3,
        type: "transcript.final",
        timestamp: "2026-04-15T10:20:10Z",
        payload: {
          speaker: "assistant",
          text: "I am still here after handoff.",
          is_final: true
        }
      }
    });
    expect(assistantAfterHandoff.statusCode).toBe(409);
    expect(assistantAfterHandoff.json().code).toBe("assistant_turn_forbidden_after_handoff");
  });
});

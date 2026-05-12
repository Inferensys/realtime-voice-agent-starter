#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const provider = "elevenlabs";
const providerSlug = provider.replaceAll("-", "_");

function sampleProviderEvents(callId) {
  return [
    {
      id: "el-001",
      call_id: callId,
      timestamp: "2026-01-01T00:02:00.000Z",
      type: "user_transcript",
      conversation_id: "conv_sample_001",
      user_transcript: "Can you check whether order A123 has shipped?"
    },
    {
      id: "el-002",
      call_id: callId,
      timestamp: "2026-01-01T00:02:01.000Z",
      type: "agent_response",
      conversation_id: "conv_sample_001",
      agent_response: "I can check that now. I will look up order A123."
    },
    {
      id: "el-003",
      call_id: callId,
      timestamp: "2026-01-01T00:02:01.350Z",
      type: "audio",
      conversation_id: "conv_sample_001",
      audio_event: {
        audio_base_64: "AAAAECAwQFBgc=",
        alignment: {
          chars: ["I", " ", "c", "a", "n"]
        }
      }
    }
  ];
}

function mapElevenLabsEvent(raw, callId, sequence) {
  const body = record(raw);
  const eventName = text(body.type) || text(body.event);

  if (eventName.includes("user_transcript")) {
    return [
      normalizedEvent(callId, "transcript.final", {
        speaker: "caller",
        text: text(body.user_transcript) || text(body.text),
        is_final: true,
        raw: body
      }, body, sequence)
    ];
  }

  if (eventName.includes("agent_response")) {
    return [
      normalizedEvent(callId, "transcript.final", {
        speaker: "assistant",
        text: text(body.agent_response) || text(body.text),
        is_final: true,
        raw: body
      }, body, sequence)
    ];
  }

  if (eventName.includes("audio")) {
    const audioEvent = record(body.audio_event);
    return [
      normalizedEvent(callId, "audio.output", {
        conversation_id: text(body.conversation_id),
        audio: body.audio ?? text(audioEvent.audio_base_64),
        alignment: record(audioEvent.alignment),
        raw: body
      }, body, sequence)
    ];
  }

  return [
    normalizedEvent(callId, "audio.output", {
      raw: body
    }, body, sequence)
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const { callId, providerEvents } = await loadProviderEvents(args);
  const normalizedEvents = mapProviderEvents(providerEvents, callId);
  const baseUrl = trimTrailingSlash(args.baseUrl);

  if (args.post) {
    const posted = await postToControlPlane(baseUrl, callId, providerEvents, normalizedEvents);
    console.log(JSON.stringify(posted, null, 2));
    return;
  }

  console.log(JSON.stringify({
    mode: "sample",
    provider,
    credentials_required: false,
    call_start: callStartPayload(callId),
    routes: routeSummary(baseUrl, callId),
    provider_events: providerEvents,
    normalized_events: normalizedEvents
  }, null, 2));
}

function mapProviderEvents(providerEvents, fallbackCallId) {
  const normalizedEvents = [];
  for (const raw of providerEvents) {
    const body = record(raw);
    const callId = callIdFromRaw(body, fallbackCallId);
    normalizedEvents.push(...mapElevenLabsEvent(body, callId, normalizedEvents.length + 1));
  }
  return normalizedEvents;
}

async function loadProviderEvents(args) {
  if (!args.inputPath) {
    const callId = args.callId ?? defaultCallId();
    return {
      callId,
      providerEvents: sampleProviderEvents(callId)
    };
  }

  const parsed = JSON.parse(await readFile(args.inputPath, "utf8"));
  const inputEvents = Array.isArray(parsed) ? parsed : Array.isArray(parsed.events) ? parsed.events : [parsed];
  const firstCallId = inputEvents
    .map((event) => callIdFromRaw(record(event), ""))
    .find(Boolean);
  const callId = args.callId ?? firstCallId ?? defaultCallId();
  return {
    callId,
    providerEvents: inputEvents.map((event) => {
      const body = record(event);
      return { ...body, call_id: callIdFromRaw(body, callId) };
    })
  };
}

async function postToControlPlane(baseUrl, callId, providerEvents, normalizedEvents) {
  const started = await requestJson(`${baseUrl}/api/calls/start`, "POST", callStartPayload(callId));
  const webhookResults = [];

  for (const [index, raw] of providerEvents.entries()) {
    const response = await requestJson(`${baseUrl}/api/webhooks/${provider}`, "POST", raw);
    webhookResults.push({
      input_index: index + 1,
      session: response.session,
      normalized_events: response.events
    });
  }

  const replay = await requestJson(`${baseUrl}/api/calls/${encodeURIComponent(callId)}/replay`, "GET");
  return {
    mode: "post",
    provider,
    base_url: baseUrl,
    call_id: callId,
    started,
    webhook_results: webhookResults,
    local_normalized_preview: normalizedEvents,
    replay
  };
}

async function requestJson(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const responseText = await response.text();
  const payload = responseText ? parseJson(responseText) : null;
  if (!response.ok) {
    throw new Error(`${method} ${url} failed with ${response.status}: ${responseText}`);
  }
  return payload;
}

function callStartPayload(callId) {
  return {
    call_id: callId,
    source: "elevenlabs-agent-bridge-sample",
    caller: {
      phone_e164: "+15550101003",
      locale: "en-US"
    },
    context: {
      tenant: "demo",
      queue: "orders",
      request_id: `corr_${callId}`
    },
    capabilities: {
      allow_handoff: true,
      allow_tool_calls: true
    }
  };
}

function routeSummary(baseUrl, callId) {
  return {
    start_call: `POST ${baseUrl}/api/calls/start`,
    provider_webhook: `POST ${baseUrl}/api/webhooks/${provider}`,
    normalized_event: `POST ${baseUrl}/api/calls/${callId}/events`,
    replay: `GET ${baseUrl}/api/calls/${callId}/replay`
  };
}

function normalizedEvent(callId, type, payload, raw, sequence) {
  const body = record(raw);
  const providerEventId = text(body.event_id) || text(body.eventId) || text(body.id);
  return {
    event_id: providerEventId ? `${providerSlug}_${providerEventId}` : `evt_${providerSlug}_${type.replaceAll(".", "_")}_${sequence}`,
    call_id: callId,
    provider,
    type,
    timestamp: text(body.timestamp) || new Date().toISOString(),
    sequence,
    correlation_id: text(body.correlation_id) || text(body.correlationId) || `corr_${callId}`,
    payload
  };
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.VOICE_API_BASE_URL ?? "http://127.0.0.1:8000",
    callId: undefined,
    help: false,
    inputPath: undefined,
    post: process.env.VOICE_BRIDGE_POST === "1"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--post") {
      args.post = true;
    } else if (arg === "--input") {
      args.inputPath = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--base-url") {
      args.baseUrl = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--call-id") {
      args.callId = requireValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node examples/elevenlabs-agent-bridge/run.mjs [options]

Options:
  --input <path>      JSON provider event, array, or {"events": [...]} to map.
  --post              Start a call and POST raw events to /api/webhooks/elevenlabs.
  --base-url <url>    Control plane URL. Defaults to VOICE_API_BASE_URL or http://127.0.0.1:8000.
  --call-id <id>      Override the sample/input call id.
  -h, --help          Show this help.

Default mode prints a local smoke replay and does not require ElevenLabs credentials or a running server.`);
}

function callIdFromRaw(raw, fallback) {
  return text(raw.call_id) || text(raw.callId) || fallback;
}

function defaultCallId() {
  return `call_${providerSlug}_${Date.now()}`;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : "";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

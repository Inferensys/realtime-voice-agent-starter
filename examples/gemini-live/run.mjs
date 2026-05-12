#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const provider = "gemini-live";
const providerSlug = provider.replaceAll("-", "_");

function sampleProviderEvents(callId) {
  return [
    {
      id: "gml-001",
      call_id: callId,
      timestamp: "2026-01-01T00:00:01.000Z",
      serverContent: {
        inputTranscription: {
          text: "I need to change tomorrow's delivery slot."
        }
      }
    },
    {
      id: "gml-002",
      call_id: callId,
      timestamp: "2026-01-01T00:00:01.900Z",
      serverContent: {
        outputTranscription: {
          text: "I can help with that. Which order number should I check?"
        }
      }
    },
    {
      id: "gml-003",
      call_id: callId,
      timestamp: "2026-01-01T00:00:02.300Z",
      serverContent: {
        interrupted: true
      }
    },
    {
      id: "gml-004",
      call_id: callId,
      timestamp: "2026-01-01T00:00:02.900Z",
      serverContent: {
        modelTurn: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/pcm;rate=24000",
                data: "AAAAECAwQFBgc="
              }
            }
          ]
        }
      }
    }
  ];
}

function mapGeminiLiveEvent(raw, callId, sequence) {
  const body = record(raw);
  const serverContent = record(body.serverContent);
  const inputTranscript = record(serverContent.inputTranscription);
  const outputTranscript = record(serverContent.outputTranscription);

  if (text(inputTranscript.text)) {
    return [
      normalizedEvent(callId, "transcript.final", {
        speaker: "caller",
        text: text(inputTranscript.text),
        is_final: true,
        raw: body
      }, body, sequence)
    ];
  }

  if (text(outputTranscript.text)) {
    return [
      normalizedEvent(callId, "transcript.partial", {
        speaker: "assistant",
        text: text(outputTranscript.text),
        is_final: false,
        raw: body
      }, body, sequence)
    ];
  }

  if (serverContent.interrupted === true) {
    return [
      normalizedEvent(callId, "turn.interrupted", {
        name: "interruption-cancel",
        value_ms: numberOr(serverContent.interruptionLatencyMs, 0),
        raw: body
      }, body, sequence)
    ];
  }

  const modelTurn = record(serverContent.modelTurn);
  const parts = Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
  const audioChunks = parts
    .map((part) => record(record(part).inlineData))
    .filter((inlineData) => text(inlineData.data))
    .map((inlineData) => ({
      mime_type: text(inlineData.mimeType) || "audio/pcm",
      data: text(inlineData.data)
    }));

  return [
    normalizedEvent(callId, "audio.output", {
      audio_chunks: audioChunks,
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
    normalizedEvents.push(...mapGeminiLiveEvent(body, callId, normalizedEvents.length + 1));
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
    source: "gemini-live-sample",
    caller: {
      phone_e164: "+15550101001",
      locale: "en-US"
    },
    context: {
      tenant: "demo",
      queue: "delivery-support",
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
  console.log(`Usage: node examples/gemini-live/run.mjs [options]

Options:
  --input <path>      JSON provider event, array, or {"events": [...]} to map.
  --post              Start a call and POST raw events to /api/webhooks/gemini-live.
  --base-url <url>    Control plane URL. Defaults to VOICE_API_BASE_URL or http://127.0.0.1:8000.
  --call-id <id>      Override the sample/input call id.
  -h, --help          Show this help.

Default mode prints a local smoke replay and does not require provider credentials or a running server.`);
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

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

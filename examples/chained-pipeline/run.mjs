#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exampleDir = dirname(fileURLToPath(import.meta.url));
loadEnv(join(exampleDir, ".env"));

const dryRun = process.argv.includes("--dry-run");
const baseUrl = trimTrailingSlash(readArg("base-url") ?? process.env.VOICE_API_BASE_URL ?? "http://127.0.0.1:8000");
const callId = readArg("call-id") ?? process.env.CALL_ID ?? `call_chained_pipeline_${Date.now()}`;
const correlationId = `corr_${callId}`;
const startedAt = Date.now();

let sequence = 0;

const startPayload = {
  call_id: callId,
  source: "local-chained-pipeline",
  caller: {
    phone_e164: "+15550101010",
    locale: "en-US"
  },
  context: {
    tenant: "demo-retail",
    queue: "warranty-intake",
    request_id: correlationId
  },
  capabilities: {
    allow_handoff: true,
    allow_tool_calls: true
  }
};

const transcript = "Can you check whether my replacement is still covered by warranty?";
const toolCallId = `tool_${callId}_lookup_warranty`;
const assistantText = "Your replacement is covered through May 2027, and I can start the exchange now.";

const events = [
  event("audio.input", {
    stream_id: "dg_stream_001",
    encoding: "linear16",
    sample_rate_hz: 16000,
    chunk_ms: 240,
    bytes: 7680
  }, "deepgram"),
  event("transcript.partial", {
    speaker: "caller",
    text: "Can you check whether my replacement",
    confidence: 0.88,
    is_final: false
  }, "deepgram"),
  event("transcript.final", {
    speaker: "caller",
    text: transcript,
    confidence: 0.96,
    is_final: true
  }, "deepgram"),
  event("latency.marker", {
    name: "first-token",
    value_ms: 184,
    budget_ms: 500
  }, "openai-realtime"),
  event("tool.call", {
    tool_call_id: toolCallId,
    tool_name: "lookup_warranty",
    arguments: {
      phone_e164: startPayload.caller.phone_e164,
      product: "replacement device"
    }
  }, "openai-realtime"),
  event("tool.result", {
    tool_call_id: toolCallId,
    result: {
      eligible: true,
      warranty_expires_on: "2027-05-09",
      next_step: "exchange_request"
    }
  }, "fake"),
  event("transcript.final", {
    speaker: "assistant",
    text: assistantText,
    confidence: 1,
    is_final: true
  }, "openai-realtime"),
  event("audio.output", {
    text: assistantText,
    voice: "cartesia-sonic-2",
    format: "pcm_s16le_24000",
    chunk_index: 1,
    bytes: 9600
  }, "cartesia"),
  event("latency.marker", {
    name: "first-audio",
    value_ms: 236,
    budget_ms: 700
  }, "cartesia"),
  event("audio.output", {
    text: assistantText,
    voice: "cartesia-sonic-2",
    format: "pcm_s16le_24000",
    chunk_index: 2,
    bytes: 10440,
    final: true
  }, "cartesia")
];

if (dryRun) {
  console.log(JSON.stringify({
    mode: "dry-run",
    base_url: baseUrl,
    call_start: startPayload,
    events,
    replay_url: `${baseUrl}/api/calls/${callId}/replay`
  }, null, 2));
  process.exit(0);
}

await postJson("/api/calls/start", startPayload);
for (const item of events) {
  await postJson(`/api/calls/${callId}/events`, item);
  console.log(`${item.sequence}. ${item.provider} -> ${item.type}`);
}

const replay = await getJson(`/api/calls/${callId}/replay`);
console.log(JSON.stringify({
  call_id: replay.call_id,
  state: replay.state,
  transcript: replay.transcript.map((segment) => `${segment.speaker}: ${segment.text}`),
  tool_calls: replay.tool_calls,
  event_counts: countTypes(replay.events),
  providers: [...new Set(replay.events.map((item) => item.provider))]
}, null, 2));

function event(type, payload, provider) {
  sequence += 1;
  return {
    event_id: `evt_${callId}_${sequence}_${type.replaceAll(".", "_")}`,
    call_id: callId,
    provider,
    correlation_id: correlationId,
    sequence,
    type,
    timestamp: new Date(startedAt + sequence * 250).toISOString(),
    payload
  };
}

async function getJson(path) {
  return requestJson("GET", path);
}

async function postJson(path, body) {
  return requestJson("POST", path, body);
}

async function requestJson(method, path, body) {
  const url = `${baseUrl}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(`Could not reach ${url}. Start the control plane with "npm run dev". ${error.message}`);
  }

  const text = await response.text();
  const parsed = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function countTypes(items) {
  return items.reduce((counts, item) => {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
    return counts;
  }, {});
}

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function loadEnv(path) {
  if (!existsSync(path)) {
    return;
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalsAt).trim();
    const rawValue = trimmed.slice(equalsAt + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

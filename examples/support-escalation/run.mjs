#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exampleDir = dirname(fileURLToPath(import.meta.url));
loadEnv(join(exampleDir, ".env"));

const dryRun = process.argv.includes("--dry-run");
const baseUrl = trimTrailingSlash(readArg("base-url") ?? process.env.VOICE_API_BASE_URL ?? "http://127.0.0.1:8000");
const handoffQueue = process.env.HANDOFF_QUEUE || "support-specialist";
const callId = readArg("call-id") ?? process.env.CALL_ID ?? `call_support_escalation_${Date.now()}`;
const correlationId = `corr_${callId}`;
const startedAt = Date.now();

let sequence = 0;

const startPayload = {
  call_id: callId,
  source: "local-support-escalation",
  caller: {
    phone_e164: "+15550102020",
    locale: "en-US"
  },
  context: {
    tenant: "demo-support",
    queue: "tier1-support",
    request_id: correlationId
  },
  capabilities: {
    allow_handoff: true,
    allow_tool_calls: true
  }
};

const transcriptEvent = event("transcript.final", {
  speaker: "caller",
  text: "I need a human specialist because this refund was already rejected twice.",
  confidence: 0.95,
  is_final: true
}, "assemblyai");

const handoffRequest = {
  event_id: `evt_${callId}_handoff_requested`,
  correlation_id: correlationId,
  type: "handoff.requested",
  timestamp: new Date(startedAt + 1000).toISOString(),
  payload: {
    requested_by: "voice-agent",
    reason_code: "refund_policy_exception",
    target_queue: handoffQueue,
    last_transcript_seq: transcriptEvent.sequence,
    context_snapshot_uri: `memory://calls/${callId}/handoff-context`
  }
};

const handoffAccepted = event("handoff.accepted", {
  agent_id: "agent_ava_001",
  accept_time: new Date(startedAt + 1750).toISOString(),
  queue: handoffQueue
}, "livekit");

if (dryRun) {
  console.log(JSON.stringify({
    mode: "dry-run",
    base_url: baseUrl,
    call_start: startPayload,
    transcript_event: transcriptEvent,
    handoff_request: handoffRequest,
    handoff_accepted: handoffAccepted,
    replay_url: `${baseUrl}/api/calls/${callId}/replay`
  }, null, 2));
  process.exit(0);
}

await postJson("/api/calls/start", startPayload);
await postJson(`/api/calls/${callId}/events`, transcriptEvent);
console.log(`${transcriptEvent.sequence}. transcript committed at sequence ${transcriptEvent.sequence}`);

const handoff = await postJson(`/api/calls/${callId}/handoff`, handoffRequest);
console.log(`handoff requested -> ${handoff.session.state}`);

const accepted = await postJson(`/api/calls/${callId}/events`, handoffAccepted);
console.log(`${handoffAccepted.sequence}. human accepted -> ${accepted.state}`);

const replay = await getJson(`/api/calls/${callId}/replay`);
console.log(JSON.stringify({
  call_id: replay.call_id,
  state: replay.state,
  handoff: replay.events.find((item) => item.type === "handoff.requested")?.payload,
  accepted_agent_id: replay.events.find((item) => item.type === "handoff.accepted")?.payload?.agent_id,
  replay_events: replay.events.map((item) => ({
    sequence: item.sequence,
    type: item.type,
    provider: item.provider
  })),
  transcript: replay.transcript
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
    timestamp: new Date(startedAt + sequence * 500).toISOString(),
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

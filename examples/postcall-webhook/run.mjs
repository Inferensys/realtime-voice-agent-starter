#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exampleDir = dirname(fileURLToPath(import.meta.url));
loadEnv(join(exampleDir, ".env"));

const dryRun = process.argv.includes("--dry-run");
const baseUrl = trimTrailingSlash(readArg("base-url") ?? process.env.VOICE_API_BASE_URL ?? "http://127.0.0.1:8000");
const callId = readArg("call-id") ?? process.env.CALL_ID ?? `call_postcall_webhook_${Date.now()}`;
const correlationId = `corr_${callId}`;
const startedAt = Date.now();

let sequence = 0;

const startPayload = {
  call_id: callId,
  source: "local-postcall-webhook",
  caller: {
    phone_e164: "+15550104040",
    locale: "en-US"
  },
  context: {
    tenant: "demo-ops",
    queue: "billing",
    request_id: correlationId
  },
  capabilities: {
    allow_handoff: true,
    allow_tool_calls: true
  }
};

const events = [
  event("transcript.final", {
    speaker: "caller",
    text: "Please update the billing contact to finance@example.com.",
    confidence: 0.95,
    is_final: true
  }, "deepgram"),
  event("transcript.final", {
    speaker: "assistant",
    text: "I verified the account and noted the billing contact update request.",
    confidence: 1,
    is_final: true
  }, "openai-realtime"),
  event("call.closing", {
    reason: "caller_request_complete"
  }, "fake"),
  event("call.closed", {
    duration_ms: 42300,
    hangup_by: "caller"
  }, "fake")
];

const postcallRequest = {
  summary_version: "v1",
  integration_targets: ["crm", "ticketing"]
};

const webhookTargets = [
  ["crm", process.env.CRM_WEBHOOK_URL],
  ["ticketing", process.env.TICKETING_WEBHOOK_URL]
].filter(([, url]) => Boolean(url));

if (dryRun) {
  console.log(JSON.stringify({
    mode: "dry-run",
    base_url: baseUrl,
    call_start: startPayload,
    events,
    postcall_request: postcallRequest,
    webhook_targets: webhookTargets.map(([name, url]) => ({ name, url })),
    replay_url: `${baseUrl}/api/calls/${callId}/replay`
  }, null, 2));
  process.exit(0);
}

await postJson("/api/calls/start", startPayload);
for (const item of events) {
  await postJson(`/api/calls/${callId}/events`, item);
  console.log(`${item.sequence}. ${item.type}`);
}

const postcall = await postJson(`/api/calls/${callId}/postcall`, postcallRequest);
console.log(`postcall summary ready -> ${postcall.envelope.event_id}`);

const deliveries = [];
for (const [name, url] of webhookTargets) {
  deliveries.push(await deliverWebhook(name, url, postcall.envelope));
}

const replay = await getJson(`/api/calls/${callId}/replay`);
console.log(JSON.stringify({
  call_id: replay.call_id,
  state: replay.state,
  post_summary: replay.post_summary,
  webhook_deliveries: deliveries.length > 0 ? deliveries : "skipped; set CRM_WEBHOOK_URL and/or TICKETING_WEBHOOK_URL",
  replay_events: replay.events.map((item) => ({
    sequence: item.sequence,
    type: item.type,
    provider: item.provider
  }))
}, null, 2));

async function deliverWebhook(name, url, envelope) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope)
    });
  } catch (error) {
    return {
      target: name,
      url,
      ok: false,
      error: error.message
    };
  }
  const text = await response.text();
  return {
    target: name,
    url,
    status: response.status,
    ok: response.ok,
    body: text.slice(0, 500)
  };
}

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

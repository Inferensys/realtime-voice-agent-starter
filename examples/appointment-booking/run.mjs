#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const exampleDir = dirname(fileURLToPath(import.meta.url));
loadEnv(join(exampleDir, ".env"));

const dryRun = process.argv.includes("--dry-run");
const baseUrl = trimTrailingSlash(readArg("base-url") ?? process.env.VOICE_API_BASE_URL ?? "http://127.0.0.1:8000");
const callId = readArg("call-id") ?? process.env.CALL_ID ?? `call_appointment_booking_${Date.now()}`;
const correlationId = `corr_${callId}`;
const startedAt = Date.now();

let sequence = 0;

const startPayload = {
  call_id: callId,
  source: "local-appointment-booking",
  caller: {
    phone_e164: "+15550103030",
    locale: "en-US"
  },
  context: {
    tenant: "demo-clinic",
    queue: "scheduling",
    request_id: correlationId
  },
  capabilities: {
    allow_handoff: true,
    allow_tool_calls: true
  }
};

const checkAvailabilityCallId = `tool_${callId}_check_availability`;
const bookAppointmentCallId = `tool_${callId}_book_appointment`;
const availabilityArgs = {
  service: "dental cleaning",
  preferred_date: "2026-05-19",
  preferred_window: "morning",
  timezone: "America/Los_Angeles"
};
const bookingArgs = {
  slot_id: "slot_2026_05_19_1030",
  patient_phone_e164: startPayload.caller.phone_e164,
  service: "dental cleaning"
};

const fallbackAvailabilityResult = {
  slots: [
    {
      slot_id: bookingArgs.slot_id,
      starts_at: "2026-05-19T10:30:00-07:00",
      provider: "Dr. Rivera"
    },
    {
      slot_id: "slot_2026_05_19_1145",
      starts_at: "2026-05-19T11:45:00-07:00",
      provider: "Dr. Chen"
    }
  ]
};

const fallbackBookingResult = {
  confirmation_id: "apt_7T4J9Q",
  status: "booked",
  starts_at: "2026-05-19T10:30:00-07:00",
  provider: "Dr. Rivera"
};

const availabilityResult = dryRun
  ? fallbackAvailabilityResult
  : await toolResult("check_availability", availabilityArgs, fallbackAvailabilityResult);
const bookingResult = dryRun
  ? fallbackBookingResult
  : await toolResult("book_appointment", bookingArgs, fallbackBookingResult);

const events = [
  event("transcript.final", {
    speaker: "caller",
    text: "I need to book a dental cleaning next Tuesday morning.",
    confidence: 0.97,
    is_final: true
  }, "deepgram"),
  event("tool.call", {
    tool_call_id: checkAvailabilityCallId,
    tool_name: "check_availability",
    arguments: availabilityArgs
  }, "openai-realtime"),
  event("tool.result", {
    tool_call_id: checkAvailabilityCallId,
    result: availabilityResult
  }, "fake"),
  event("transcript.final", {
    speaker: "assistant",
    text: "I have Tuesday at 10:30 AM with Dr. Rivera or 11:45 AM with Dr. Chen.",
    confidence: 1,
    is_final: true
  }, "openai-realtime"),
  event("transcript.final", {
    speaker: "caller",
    text: "Please book the 10:30 appointment.",
    confidence: 0.96,
    is_final: true
  }, "deepgram"),
  event("tool.call", {
    tool_call_id: bookAppointmentCallId,
    tool_name: "book_appointment",
    arguments: bookingArgs
  }, "openai-realtime"),
  event("tool.result", {
    tool_call_id: bookAppointmentCallId,
    result: bookingResult
  }, "fake"),
  event("transcript.final", {
    speaker: "assistant",
    text: "You are booked for Tuesday, May 19 at 10:30 AM with Dr. Rivera. Your confirmation is apt_7T4J9Q.",
    confidence: 1,
    is_final: true
  }, "openai-realtime")
];

if (dryRun) {
  console.log(JSON.stringify({
    mode: "dry-run",
    base_url: baseUrl,
    appointment_api_url: process.env.APPOINTMENT_API_URL || null,
    call_start: startPayload,
    events,
    replay_url: `${baseUrl}/api/calls/${callId}/replay`
  }, null, 2));
  process.exit(0);
}

await postJson("/api/calls/start", startPayload);
for (const item of events) {
  await postJson(`/api/calls/${callId}/events`, item);
  console.log(`${item.sequence}. ${item.type}`);
}

const replay = await getJson(`/api/calls/${callId}/replay`);
console.log(JSON.stringify({
  call_id: replay.call_id,
  state: replay.state,
  transcript: replay.transcript.map((segment) => `${segment.speaker}: ${segment.text}`),
  tool_calls: replay.tool_calls.map((call) => ({
    tool_call_id: call.toolCallId,
    tool_name: call.toolName,
    status: call.status,
    result: call.result
  }))
}, null, 2));

async function toolResult(toolName, args, fallbackResult) {
  const endpoint = process.env.APPOINTMENT_API_URL;
  if (!endpoint) {
    return fallbackResult;
  }
  const headers = { "content-type": "application/json" };
  if (process.env.APPOINTMENT_API_KEY) {
    headers.authorization = `Bearer ${process.env.APPOINTMENT_API_KEY}`;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ tool_name: toolName, arguments: args })
  });
  const text = await response.text();
  const parsed = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Appointment API ${toolName} failed with HTTP ${response.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
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

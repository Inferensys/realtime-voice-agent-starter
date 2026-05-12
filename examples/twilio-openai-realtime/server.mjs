#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, ".env"));

const host = process.env.EXAMPLE_HOST || "127.0.0.1";
const port = Number(process.env.EXAMPLE_PORT || 8788);
const publicBaseUrl = trimSlash(process.env.PUBLIC_BASE_URL || `http://${host}:${port}`);
const voiceApiBaseUrl = trimSlash(process.env.VOICE_API_BASE_URL || "http://127.0.0.1:8000");
const sampleMode = process.argv.includes("--sample");

const activeStreams = new Map();

if (sampleMode) {
  runSample()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
} else {
  startServer();
}

function startServer() {
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/healthz") {
        return sendJson(res, 200, { ok: true, provider: "twilio-media-streams" });
      }

      if (req.method === "POST" && url.pathname === "/twiml") {
        return sendXml(res, buildTwiml());
      }

      if (req.method === "GET" && url.pathname === "/") {
        return sendJson(res, 200, {
          example: "twilio-openai-realtime",
          twimlWebhook: `${publicBaseUrl}/twiml`,
          mediaWebSocket: toWebSocketUrl(`${publicBaseUrl}/media`)
        });
      }

      return sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, { error: error.message });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/media") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleMediaSocket(ws));
  });

  server.listen(port, host, () => {
    console.log(`Twilio Media Streams example: http://${host}:${port}`);
    console.log(`Twilio Voice webhook: ${publicBaseUrl}/twiml`);
    console.log(`Control plane: ${voiceApiBaseUrl}`);
  });
}

function handleMediaSocket(ws) {
  ws.on("message", async (message) => {
    try {
      const raw = JSON.parse(message.toString("utf8"));
      const result = await handleTwilioEvent(raw);
      if (result?.eventTypes?.length) {
        console.log(`[${result.callId}] ${result.eventTypes.join(", ")}`);
      }
    } catch (error) {
      console.error("Twilio media event failed:", error.message);
    }
  });
}

async function handleTwilioEvent(raw) {
  const eventName = raw.event;
  const streamSid = raw.streamSid || raw.start?.streamSid || raw.stop?.streamSid || raw.mark?.streamSid;
  const existing = streamSid ? activeStreams.get(streamSid) : undefined;
  const callId =
    raw.call_id ||
    raw.callId ||
    raw.start?.customParameters?.call_id ||
    raw.start?.customParameters?.callId ||
    existing?.callId ||
    streamSid ||
    `twilio-${Date.now()}`;

  if (eventName === "start") {
    await ensureCall(callId, {
      streamSid,
      providerCallSid: raw.start?.callSid,
      from: raw.start?.customParameters?.from || process.env.CALLER_PHONE_E164,
      transport: "twilio-media-streams"
    });
    if (streamSid) activeStreams.set(streamSid, { callId });
  }

  if (!eventName) {
    throw new Error("Twilio event name is required");
  }

  if (eventName === "stop") {
    await postNormalizedEvent(callId, {
      type: "call.closing",
      timestamp: new Date().toISOString(),
      sequence: Date.now(),
      metadata: { provider: "twilio-media-streams", streamSid }
    });
  }

  const body = {
    ...raw,
    call_id: callId
  };
  const result = await requestJson(`${voiceApiBaseUrl}/api/webhooks/twilio-media-streams`, {
    method: "POST",
    body
  });

  if (eventName === "stop" && streamSid) activeStreams.delete(streamSid);

  return {
    callId,
    eventTypes: Array.isArray(result.events) ? result.events.map((event) => event.type) : []
  };
}

async function ensureCall(callId, metadata = {}) {
  try {
    await requestJson(`${voiceApiBaseUrl}/api/calls/${encodeURIComponent(callId)}/replay`);
    return;
  } catch {
    // The replay endpoint returns 404 for new calls. Start the call below.
  }

  await requestJson(`${voiceApiBaseUrl}/api/calls/start`, {
    method: "POST",
    body: {
      call_id: callId,
      source: "twilio-openai-realtime",
      caller: {
        phone_e164: metadata.from || process.env.CALLER_PHONE_E164 || "+15551230002",
        locale: "en-US"
      },
      context: {
        tenant: "local",
        queue: "twilio",
        request_id: `corr_${callId}`
      },
      capabilities: {
        allow_handoff: true,
        allow_tool_calls: true
      }
    }
  });
}

async function postNormalizedEvent(callId, event) {
  await requestJson(`${voiceApiBaseUrl}/api/calls/${encodeURIComponent(callId)}/events`, {
    method: "POST",
    body: {
      event_id: event.event_id || `evt_twilio_bridge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      call_id: callId,
      provider: event.provider || "twilio-media-streams",
      correlation_id: event.correlation_id || `corr_${callId}`,
      type: event.type,
      timestamp: event.timestamp || new Date().toISOString(),
      sequence: event.sequence,
      payload: event.payload || {}
    }
  });
}

async function runSample() {
  const streamSid = `MZ${Date.now()}`;
  const callId = `twilio-sample-${Date.now()}`;
  const events = [
    {
      event: "start",
      streamSid,
      start: {
        streamSid,
        callSid: `CA${Date.now()}`,
        customParameters: {
          call_id: callId,
          from: process.env.CALLER_PHONE_E164 || "+15551230002"
        }
      }
    },
    {
      event: "media",
      streamSid,
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "20",
        payload: Buffer.from("sample-mulaw-audio").toString("base64")
      }
    },
    {
      event: "mark",
      streamSid,
      mark: { name: "first-audio" }
    },
    {
      event: "stop",
      streamSid,
      stop: { streamSid }
    }
  ];

  for (const event of events) {
    const result = await handleTwilioEvent(event);
    console.log(`${event.event}: ${result.eventTypes.join(", ")}`);
  }

  const replay = await requestJson(`${voiceApiBaseUrl}/api/calls/${encodeURIComponent(callId)}/replay`);
  console.log(JSON.stringify({
    callId,
    state: replay.state,
    events: replay.events?.map((event) => event.type)
  }, null, 2));
}

function buildTwiml() {
  const mediaUrl = toWebSocketUrl(`${publicBaseUrl}/media`);
  const callId = `twilio-${Date.now()}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(mediaUrl)}">
      <Parameter name="call_id" value="${escapeXml(callId)}" />
      <Parameter name="from" value="${escapeXml(process.env.CALLER_PHONE_E164 || "+15551230002")}" />
    </Stream>
  </Connect>
</Response>`;
}

async function requestJson(url, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const data = parseMaybeJson(text);
  if (!response.ok) {
    const message = typeof data === "object" ? JSON.stringify(data) : text;
    const error = new Error(`${method} ${url} failed: ${message}`);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function sendXml(res, body) {
  res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
  res.end(body);
}

function parseMaybeJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toWebSocketUrl(url) {
  return url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

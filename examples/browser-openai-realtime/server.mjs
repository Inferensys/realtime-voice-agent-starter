#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, ".env"));

const host = process.env.EXAMPLE_HOST || "127.0.0.1";
const port = Number(process.env.EXAMPLE_PORT || 8787);
const voiceApiBaseUrl = trimSlash(process.env.VOICE_API_BASE_URL || "http://127.0.0.1:8000");
const realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const realtimeVoice = process.env.OPENAI_REALTIME_VOICE || "alloy";

const agent = {
  name: process.env.AGENT_NAME || "browser-support-agent",
  instructions:
    process.env.AGENT_INSTRUCTIONS ||
    [
      "You are a concise support voice agent.",
      "Ask one question at a time.",
      "Use short spoken answers.",
      "When an account-specific action is required, say that a human handoff is needed."
    ].join(" ")
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return sendJson(res, 200, { ok: true, provider: "openai-realtime", model: realtimeModel });
    }

    if (req.method === "POST" && url.pathname === "/calls/start") {
      const body = await readJson(req);
      const callId = body.call_id || body.callId || `browser_${Date.now()}`;
      const payload = {
        call_id: callId,
        source: "browser-openai-realtime",
        callerPhoneE164: body.callerPhoneE164 || process.env.CALLER_PHONE_E164 || "+15551230001",
        caller: {
          phone_e164: body.callerPhoneE164 || process.env.CALLER_PHONE_E164 || "+15551230001",
          locale: body.locale || "en-US"
        },
        context: {
          tenant: body.tenant || "local",
          queue: body.queue || "browser",
          request_id: `corr_${callId}`
        },
        capabilities: {
          allow_handoff: true,
          allow_tool_calls: true
        },
        metadata: {
          agent: agent.name,
          transport: "browser-webrtc",
          provider: "openai-realtime",
          model: realtimeModel
        }
      };
      const call = await requestJson(`${voiceApiBaseUrl}/api/calls/start`, {
        method: "POST",
        body: stripUnknownCallStartFields(payload)
      });
      return sendJson(res, 200, call);
    }

    if (req.method === "POST" && url.pathname === "/session") {
      if (!process.env.OPENAI_API_KEY) {
        return sendJson(res, 501, {
          error: "OPENAI_API_KEY is required on the example server to create realtime sessions."
        });
      }

      const requested = await readJson(req);
      if (!requested.sdp || typeof requested.sdp !== "string") {
        return sendJson(res, 400, { error: "sdp is required" });
      }

      const answerSdp = await createRealtimeCall({
        sdp: requested.sdp,
        model: requested.model || realtimeModel,
        voice: requested.voice || realtimeVoice,
        instructions: requested.instructions || agent.instructions
      });
      return sendJson(res, 200, {
        answerSdp,
        model: requested.model || realtimeModel,
        voice: requested.voice || realtimeVoice
      });
    }

    if (req.method === "POST" && url.pathname === "/events") {
      const body = await readJson(req);
      if (!body.callId) {
        return sendJson(res, 400, { error: "callId is required" });
      }
      if (!body.event || typeof body.event !== "object") {
        return sendJson(res, 400, { error: "event is required" });
      }

      const event = toRealtimeEvent(body.callId, body.event);

      const result = await requestJson(`${voiceApiBaseUrl}/api/calls/${body.callId}/events`, {
        method: "POST",
        body: event
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && url.pathname.startsWith("/replay/")) {
      const callId = decodeURIComponent(url.pathname.slice("/replay/".length));
      const replay = await requestJson(`${voiceApiBaseUrl}/api/calls/${callId}/replay`);
      return sendJson(res, 200, replay);
    }

    if (req.method === "GET" && url.pathname === "/config") {
      return sendJson(res, 200, {
        agent,
        model: realtimeModel,
        voice: realtimeVoice,
        voiceApiBaseUrl
      });
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      error: error.message || "Unhandled example server error"
    });
  }
});

server.listen(port, host, () => {
  console.log(`Browser OpenAI Realtime example: http://${host}:${port}`);
  console.log(`Control plane: ${voiceApiBaseUrl}`);
});

async function createRealtimeCall({ sdp, model, voice, instructions }) {
  const formData = new FormData();
  formData.set("sdp", sdp);
  formData.set("session", JSON.stringify({
    type: "realtime",
    model,
    instructions,
    audio: {
      output: {
        voice
      }
    }
  }));

  const headers = {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  };
  if (process.env.OPENAI_SAFETY_IDENTIFIER) {
    headers["OpenAI-Safety-Identifier"] = process.env.OPENAI_SAFETY_IDENTIFIER;
  }

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers,
    body: formData
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`OpenAI realtime call failed: ${text}`);
    error.statusCode = response.status;
    throw error;
  }
  return text;
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

function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  const filePath = pathname === "/" ? "/public/index.html" : `/public${pathname}`;
  const fullPath = path.normalize(path.join(__dirname, filePath));
  if (!fullPath.startsWith(__dirname) || !existsSync(fullPath)) {
    return sendJson(res, 404, { error: "Not found" });
  }

  const ext = path.extname(fullPath);
  const contentType =
    ext === ".html" ? "text/html; charset=utf-8" :
    ext === ".js" ? "text/javascript; charset=utf-8" :
    ext === ".css" ? "text/css; charset=utf-8" :
    "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(fullPath).pipe(res);
}

function toRealtimeEvent(callId, raw) {
  const {
    event_id,
    eventId,
    provider,
    correlation_id,
    correlationId,
    sequence,
    type,
    timestamp,
    payload,
    ...rest
  } = raw;

  return {
    event_id: event_id || eventId || `evt_browser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    call_id: callId,
    provider: provider || "openai-realtime",
    correlation_id: correlation_id || correlationId || `corr_${callId}`,
    sequence,
    type,
    timestamp: timestamp || new Date().toISOString(),
    payload: payload || rest
  };
}

function stripUnknownCallStartFields(payload) {
  return {
    call_id: payload.call_id,
    source: payload.source,
    caller: payload.caller,
    context: payload.context,
    capabilities: payload.capabilities
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function parseMaybeJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

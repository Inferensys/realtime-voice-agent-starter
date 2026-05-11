import { createServer } from "node:http";

const port = Number(process.env.CONSOLE_PORT ?? "3000");
const apiBase = process.env.VOICE_API_BASE_URL ?? "http://127.0.0.1:8000";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Realtime Voice Agent Kit</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #101513;
      --muted: #66706b;
      --line: #dfe5e1;
      --panel: #fbfcfb;
      --accent: #0f8f70;
    }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f6f4;
      color: var(--ink);
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: white;
    }
    h1 {
      margin: 0;
      font-size: 17px;
      letter-spacing: -0.01em;
    }
    main {
      display: grid;
      grid-template-columns: 280px 1fr;
      min-height: calc(100vh - 62px);
    }
    aside {
      border-right: 1px solid var(--line);
      background: white;
      padding: 18px;
    }
    section {
      padding: 18px;
    }
    button, select {
      border: 1px solid var(--line);
      background: white;
      padding: 9px 11px;
      border-radius: 6px;
      color: var(--ink);
      font: inherit;
    }
    button.primary {
      background: var(--ink);
      color: white;
      border-color: var(--ink);
    }
    .stack {
      display: grid;
      gap: 10px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 14px;
    }
    .panel {
      background: white;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .panel h2 {
      margin: 0 0 10px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
    }
    .event {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 10px;
      border-top: 1px solid var(--line);
      padding: 9px 0;
      font-size: 13px;
    }
    .event:first-child {
      border-top: 0;
    }
    code, pre {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
    }
    pre {
      white-space: pre-wrap;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      max-height: 360px;
      overflow: auto;
    }
    .metric {
      display: flex;
      justify-content: space-between;
      border-top: 1px solid var(--line);
      padding: 9px 0;
      font-size: 13px;
    }
    .muted {
      color: var(--muted);
    }
    @media (max-width: 760px) {
      main, .grid {
        grid-template-columns: 1fr;
      }
      aside {
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Realtime Voice Agent Kit</h1>
    <span class="muted">local dev console</span>
  </header>
  <main>
    <aside class="stack">
      <button class="primary" id="seed">Create sample call</button>
      <button id="refresh">Refresh sessions</button>
      <select id="calls"></select>
      <p class="muted">Inspect state transitions, transcripts, tool calls, handoff, latency markers, and post-call output from the local Fastify control plane.</p>
    </aside>
    <section class="grid">
      <div class="panel">
        <h2>Event timeline</h2>
        <div id="timeline" class="stack"></div>
      </div>
      <div class="stack">
        <div class="panel">
          <h2>Session</h2>
          <pre id="session">{}</pre>
        </div>
        <div class="panel">
          <h2>Latency</h2>
          <div id="latency"></div>
        </div>
        <div class="panel">
          <h2>Transcript</h2>
          <pre id="transcript">[]</pre>
        </div>
      </div>
    </section>
  </main>
  <script>
    const apiBase = ${JSON.stringify(apiBase)};
    const calls = document.getElementById("calls");
    const timeline = document.getElementById("timeline");
    const sessionEl = document.getElementById("session");
    const transcriptEl = document.getElementById("transcript");
    const latencyEl = document.getElementById("latency");

    async function post(url, payload) {
      const response = await fetch(apiBase + url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      return response.json();
    }

    async function seed() {
      const id = "call_" + Math.random().toString(36).slice(2, 8);
      await post("/api/calls/start", {
        call_id: id,
        source: "browser",
        caller: { phone_e164: "+15555550100", locale: "en-US" },
        context: { tenant: "local", queue: "support", request_id: "corr_" + id },
        capabilities: { allow_handoff: true, allow_tool_calls: true }
      });
      await post("/api/calls/" + id + "/events", {
        event_id: id + "_1",
        call_id: id,
        correlation_id: "corr_" + id,
        sequence: 1,
        type: "transcript.final",
        timestamp: new Date().toISOString(),
        payload: { speaker: "caller", text: "I need to change my appointment.", is_final: true }
      });
      await post("/api/calls/" + id + "/events", {
        event_id: id + "_2",
        call_id: id,
        correlation_id: "corr_" + id,
        sequence: 2,
        type: "tool.call",
        timestamp: new Date().toISOString(),
        payload: { tool_call_id: "tool_" + id, tool_name: "lookup_appointment", arguments: { caller: "+15555550100" } }
      });
      await post("/api/calls/" + id + "/events", {
        event_id: id + "_3",
        call_id: id,
        correlation_id: "corr_" + id,
        sequence: 3,
        type: "turn.interrupted",
        timestamp: new Date().toISOString(),
        payload: { name: "interruption-cancel", value_ms: 84 }
      });
      await refresh(id);
    }

    async function refresh(selectId) {
      const response = await fetch(apiBase + "/api/calls");
      const data = await response.json();
      calls.innerHTML = "";
      for (const call of data.calls || []) {
        const option = document.createElement("option");
        option.value = call.call_id;
        option.textContent = call.call_id + " · " + call.state;
        calls.appendChild(option);
      }
      if (selectId) calls.value = selectId;
      await loadReplay();
    }

    async function loadReplay() {
      if (!calls.value) return;
      const response = await fetch(apiBase + "/api/calls/" + calls.value + "/replay");
      const replay = await response.json();
      sessionEl.textContent = JSON.stringify({ call_id: replay.call_id, state: replay.state, tool_calls: replay.tool_calls }, null, 2);
      transcriptEl.textContent = JSON.stringify(replay.transcript || [], null, 2);
      timeline.innerHTML = "";
      for (const event of replay.events || []) {
        const row = document.createElement("div");
        row.className = "event";
        row.innerHTML = "<code>" + event.type + "</code><span>" + JSON.stringify(event.payload) + "</span>";
        timeline.appendChild(row);
      }
      latencyEl.innerHTML = "";
      for (const marker of replay.latency_markers || []) {
        const row = document.createElement("div");
        row.className = "metric";
        row.innerHTML = "<span>" + marker.name + "</span><strong>" + marker.value_ms + "ms</strong>";
        latencyEl.appendChild(row);
      }
    }

    document.getElementById("seed").addEventListener("click", seed);
    document.getElementById("refresh").addEventListener("click", () => refresh());
    calls.addEventListener("change", loadReplay);
    refresh();
  </script>
</body>
</html>`;

const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});

server.listen(port, () => {
  process.stdout.write(`Realtime Voice Agent Kit console: http://127.0.0.1:${port}\n`);
});

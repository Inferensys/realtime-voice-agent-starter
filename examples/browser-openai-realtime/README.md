# Browser OpenAI Realtime

Browser WebRTC voice agent path for teams building an in-app voice agent.

The API key stays on the example server. The browser creates a WebRTC offer,
the server exchanges that SDP with OpenAI Realtime, the browser receives the
answer SDP, streams microphone audio, plays model audio, and forwards normalized
events into the shared control plane.

## Run

```bash
cp examples/browser-openai-realtime/.env.example examples/browser-openai-realtime/.env
npm run dev
```

In another terminal:

```bash
node examples/browser-openai-realtime/server.mjs
```

Open:

```text
http://127.0.0.1:8787
```

## What it does

- Creates a call in the control plane.
- Exchanges the WebRTC SDP offer server-side with OpenAI Realtime.
- Opens a browser WebRTC connection.
- Streams microphone audio to the realtime model.
- Plays realtime audio back through the page.
- Captures transcript, audio, interruption, and latency events.
- Forwards those events into the same call replay API used by the telephony examples.

Events should still flow into:

```text
POST /api/calls/:id/events
GET /api/calls/:id/replay
```

## Useful env vars

```bash
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_REALTIME_VOICE=alloy
VOICE_API_BASE_URL=http://127.0.0.1:8000
EXAMPLE_PORT=8787
```

# Browser OpenAI Realtime

Browser WebRTC voice agent path.

## Run

```bash
cp examples/browser-openai-realtime/.env.example examples/browser-openai-realtime/.env
npm run dev
```

Use this example when the caller is in a web app and the browser receives a short-lived realtime session token from your backend.

Events should still flow into:

```text
POST /api/calls/:id/events
GET /api/calls/:id/replay
```

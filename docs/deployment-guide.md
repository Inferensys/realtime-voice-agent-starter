# Deployment Guide

The kit is a Node service. Deploy the server package anywhere you can run Node 20.

## Build

```bash
npm install
npm run build
```

## Run

```bash
PORT=8000 HOST=0.0.0.0 npm start
```

## Required Runtime Inputs

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port, defaults to `8000` |
| `HOST` | Bind address, defaults to `127.0.0.1` |
| `AGENT_CONFIG_PATH` | Optional TOML config path |
| `AZURE_OPENAI_ENDPOINT` / `OPENAI_BASE_URL` | Azure OpenAI v1 endpoint for realtime examples |
| `AZURE_OPENAI_REALTIME_DEPLOYMENT` | Azure realtime deployment name, for example `gpt-realtime-1.5` |
| `AZURE_OPENAI_API_KEY` / `OPENAI_API_KEY` | Server-side API key for examples and demos |

Provider credentials are set per example. Keep them server-side.

## Health Check

```bash
curl http://127.0.0.1:8000/healthz
```

## Production Notes

- Replace the in-memory store before running more than one process.
- Keep provider tokens out of browser code unless the provider uses short-lived ephemeral tokens.
- For browser microphones, prefer WebRTC. Use the WebSocket helper for server-side audio, call recordings, batch evals, and telephony bridges.
- Record latency markers on every production call.
- Keep replay enabled for debugging, but protect it behind your app auth.
- Send post-call events through an idempotent queue if downstream systems can retry.

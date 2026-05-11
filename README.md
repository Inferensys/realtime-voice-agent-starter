# Realtime Voice Agent Kit

Most voice-agent demos stop once audio comes out of the speaker.

This kit starts where demos usually break: interruptions, handoff, tool calls, transcript consistency, post-call events, replay, and regression tests.

It is a TypeScript starter kit for production voice agents across WebRTC, telephony, realtime model APIs, STT/TTS pipelines, barge-in, human handoff, evals, and post-call workflows.

## Why This Exists

Teams building voice AI usually hit the same problems:

- OpenAI Realtime or Gemini Live works in a small demo, then the app needs Twilio, SIP, LiveKit, or browser WebRTC.
- The first interruption breaks the turn model.
- Tool calls get mixed into transcript text.
- Handoff loses the transcript pointer.
- Post-call summaries run on partial transcripts.
- Nobody can replay what happened when latency spikes.

This repo gives you the boring control layer up front.

## What You Get

- **Provider-neutral voice events** for audio, transcripts, tools, handoff, latency, and post-call output.
- **Fastify control plane** with call start, event ingestion, handoff, transcript, replay, webhook, and WebSocket routes.
- **Reusable core package** with session state, runtime definitions, turn policy, handoff policy, transcript model, event sinks, and tool definitions.
- **Adapter package** for OpenAI Realtime, Azure OpenAI Realtime, Gemini Live, Twilio Media Streams, LiveKit, Deepgram, ElevenLabs, Cartesia, AssemblyAI, and a fake/local adapter.
- **Eval package** with eight default regression scenarios for barge-in, no-response recovery, tool failure, handoff, duplicate events, latency, and post-call webhooks.
- **Local dev console** for inspecting a call timeline, transcript stream, tool calls, handoff state, latency markers, and post-call output.
- **Examples** for browser voice, phone calls, realtime model sessions, STT/TTS chains, and downstream post-call workflows.

## Install

```bash
npm install
npm run build
npm test
```

Run the control plane:

```bash
npm run dev
```

API base URL:

```text
http://127.0.0.1:8000
```

Run the local console in another terminal:

```bash
npm run dev:console
```

Console URL:

```text
http://127.0.0.1:3000
```

## Quickstart

Start a call:

```bash
curl -s http://127.0.0.1:8000/api/calls/start \
  -H 'content-type: application/json' \
  -d @examples/call-start.json
```

Stream a transcript event:

```bash
curl -s http://127.0.0.1:8000/api/calls/call_01JBRX2W2B5P4Z11/events \
  -H 'content-type: application/json' \
  -d @examples/realtime-event.json
```

Replay the call:

```bash
curl -s http://127.0.0.1:8000/api/calls/call_01JBRX2W2B5P4Z11/replay | jq
```

Run the default voice evals:

```bash
npm run eval
```

JSON output:

```bash
npm run eval -- --json
```

## Public API

```ts
import { createVoiceRuntime, defineAgent, defineTool } from "@inferensys/realtime-voice";

const agent = defineAgent({
  name: "support-agent",
  instructions: "Resolve the caller's issue. Escalate when account verification is required.",
  tools: [
    defineTool({
      name: "lookup_order",
      schema: { orderId: "string" },
      handler: async ({ orderId }) => ({ status: "shipped", eta: "Friday" })
    })
  ],
  handoff: {
    enabled: true,
    queues: ["billing", "support-specialist"]
  }
});

const runtime = createVoiceRuntime({
  agent,
  transport: "twilio-media-streams",
  model: "openai-realtime",
  turnPolicy: "interruptible",
  store: "memory"
});
```

## Architecture

```mermaid
flowchart LR
  Caller[Caller / Browser / Phone] --> Transport[Transport Adapter]
  Transport --> Server[Fastify Control Plane]
  Server --> Core[Core Runtime Contracts]
  Server --> Replay[Event Replay]
  Server --> Transcript[Transcript Store]
  Server --> Handoff[Human Handoff]
  Server --> PostCall[Post-call Events]
  Provider[Realtime Model / STT / TTS] --> Transport
  Evals[Voice Eval Runner] --> Server
  Console[Dev Console] --> Server
```

The split is deliberate:

- Media adapters deal with provider-specific formats.
- The control plane owns state, sequence guards, idempotency, handoff, replay, and post-call flow.
- Core contracts keep app logic independent from Twilio, LiveKit, OpenAI, Deepgram, ElevenLabs, Cartesia, and the next provider that shows up.

## Packages

| Package | Purpose |
| --- | --- |
| `@inferensys/realtime-voice` | Core contracts, state machine, runtime helpers, session store |
| `@inferensys/realtime-voice-server` | Fastify HTTP/WebSocket control plane |
| `@inferensys/realtime-voice-adapters` | Provider event adapters |
| `@inferensys/realtime-voice-evals` | Voice eval scenarios and CLI |
| `@inferensys/realtime-voice-dev-console` | Local browser console |

## Provider Matrix

| Provider | Current support | Notes |
| --- | --- | --- |
| Fake/local | Event adapter | Used by tests, evals, and local workflows |
| OpenAI Realtime | Event adapter | Audio, transcript, interruption, and tool-call event mapping |
| Azure OpenAI Realtime | Event adapter | Same normalized event surface as OpenAI Realtime |
| Gemini Live | Event adapter | Transcript, interruption, and output event mapping |
| Twilio Media Streams | Event adapter | Start, media, mark, and stop event mapping |
| LiveKit | Event adapter | Transcript and handoff-style event mapping |
| Deepgram | Event adapter | Streaming transcript event mapping |
| ElevenLabs | Event adapter | User transcript, agent response, and audio output mapping |
| Cartesia | Event adapter | Streaming TTS output mapping |
| AssemblyAI | Event adapter | Streaming transcript and redaction-friendly payload mapping |

These adapters normalize provider events into the kit’s event model. The examples show where to add provider credentials and session bootstrap code.

## HTTP And WebSocket Routes

| Route | Purpose |
| --- | --- |
| `POST /api/calls/start` | Create a call session |
| `POST /api/calls/:id/events` | Ingest normalized voice events |
| `POST /api/calls/:id/handoff` | Request human handoff |
| `GET /api/calls/:id/transcript` | Read committed transcript segments |
| `POST /api/calls/:id/postcall` | Emit post-call summary event |
| `GET /api/calls/:id/replay` | Replay events, transcript, tools, latency, and post-call output |
| `GET /api/calls` | List local sessions |
| `POST /api/webhooks/:provider` | Normalize provider webhook/event payloads |
| `WS /api/realtime/:provider` | Provider WebSocket entrypoint |

## Examples

Each example has an `.env.example` and README:

- `examples/browser-openai-realtime`
- `examples/twilio-openai-realtime`
- `examples/azure-openai-realtime`
- `examples/gemini-live`
- `examples/livekit-room-agent`
- `examples/chained-pipeline`
- `examples/elevenlabs-agent-bridge`
- `examples/assemblyai-redaction`
- `examples/support-escalation`
- `examples/appointment-booking`
- `examples/postcall-webhook`

The examples are intentionally thin. The important part is that every path emits the same normalized event timeline.

## Evals

The default suite covers:

- Standard intake
- Barge-in
- Silence timeout
- Duplicate event
- Slow model
- Tool failure
- Handoff
- Post-call webhook

Run:

```bash
npm run eval
```

Use evals in CI before changing prompts, providers, tools, or handoff policy.

## Docs

- `docs/architecture.md`
- `docs/event-model.md`
- `docs/adapter-guide.md`
- `docs/eval-guide.md`
- `docs/deployment-guide.md`
- `docs/session-state-machine.md`
- `docs/integration-contracts.md`
- `docs/validation-matrix.md`

## Repo Description

Suggested GitHub description:

```text
TypeScript starter kit for production voice agents: WebRTC, telephony, realtime model APIs, STT/TTS pipelines, barge-in, handoff, evals, and post-call workflows.
```

Suggested topics:

```text
voice-ai, voice-agents, realtime-voice, realtime-audio, speech-to-speech, openai-realtime, azure-openai, gemini-live, twilio-media-streams, livekit, webrtc, deepgram, elevenlabs, cartesia, assemblyai, barge-in, handoff, voice-agent-evals, fastify, typescript
```

## License

MIT

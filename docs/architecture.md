# Architecture

Realtime Voice Agent Kit separates provider plumbing from call correctness.

## Layers

1. **Provider adapters**
   - Convert OpenAI, Azure OpenAI, Gemini, Twilio, LiveKit, Deepgram, ElevenLabs, Cartesia, AssemblyAI, or fake/local events into one event model.
   - No business rules live here.

2. **Control plane**
   - Fastify HTTP/WebSocket service.
   - Owns call session state, idempotency, sequence guards, handoff, replay, transcript access, and post-call event generation.

3. **Core runtime**
   - Package-level contracts for events, sessions, tools, policies, runtime definitions, transcripts, and stores.
   - Used by server, adapters, evals, and application code.

4. **Evals**
   - Synthetic call scenarios that catch the bugs teams usually find in production: interruptions, duplicate events, tool failures, slow responses, handoff drift, and post-call race conditions.

5. **Dev console**
   - Local browser view for event timelines, transcripts, tool calls, latency markers, and handoff state.

## Event Flow

```text
provider payload
  -> adapter.normalizeProviderEvent()
  -> POST /api/calls/:id/events or POST /api/webhooks/:provider
  -> processRealtimeEvent()
  -> session.events + transcript + tool calls + latency markers
  -> /api/calls/:id/replay
```

## Latency Path

Track these markers per call:

- `first-token`
- `first-audio`
- `user-stop-to-agent-start`
- `interruption-cancel`
- `handoff-latency`

The kit does not hide these inside provider logs. They are first-class events so CI, replay, and dashboards can read them the same way.

## Handoff Path

Handoff is explicit:

```text
active -> escalated -> handoff_pending -> handed_off
```

After `handed_off`, assistant-generated transcript turns are rejected. That prevents the voice agent from continuing after a human has taken over.

## Storage

The starter ships with an in-memory session store. The interface is intentionally small: create, get, replace, list, append events, and replay. SQLite and Postgres implementations can be added without changing adapters or evals.

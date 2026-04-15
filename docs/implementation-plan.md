# Implementation Plan: Control Plane v1

## Objective

Deliver a first working slice of the voice-agent control plane that enforces session state transitions, ingests realtime events with idempotency and sequence guards, handles handoff requests, and emits post-call summaries.

This slice is transport-agnostic: no RTP/media pipeline, only call/session control and event contracts.

## Scope (v1)

1. Fastify HTTP service with typed request/response schemas.
2. In-memory call session registry and event idempotency tracking.
3. Deterministic state machine implementing documented states and transitions.
4. Realtime event ingestion endpoint with:
   - duplicate event rejection by `event_id`
   - monotonic sequence validation
   - transcript segment persistence
5. Handoff endpoint that transitions call state and emits a normalized integration event envelope.
6. Post-call summary endpoint gated by terminal call state.
7. Runtime configuration loaded from `configs/agent.example.toml` (or override path via env).
8. Automated tests for state transitions, duplicate handling, and handoff behavior.

## Architecture

### Runtime modules

- `src/config.ts`
  - Parses TOML config into typed runtime settings.
  - Supports `AGENT_CONFIG_PATH` override.
- `src/domain/state-machine.ts`
  - Canonical session states.
  - `transitionOrThrow(current, next)` for invariant enforcement.
- `src/domain/session-store.ts`
  - In-memory session map keyed by `call_id`.
  - Event id set per call for idempotency.
- `src/services/event-processor.ts`
  - Applies realtime events to session aggregate.
  - Enforces sequence and correlation constraints.
- `src/services/postcall.ts`
  - Builds `call.post_summary_ready` payload from final transcript + call metadata.
- `src/http/routes.ts`
  - Fastify route registration and request validation.
- `src/app.ts` and `src/index.ts`
  - App factory and server bootstrap.

### Data model

- `CallSession`
  - Identity: `callId`, `correlationId`
  - State: `state`
  - Event control: `seenEventIds`, `lastSequence`
  - Transcript: ordered segments with `speaker`, `text`, `sequence`, `isFinal`
  - Handoff metadata: request fields and acceptance status

## API slice

- `POST /api/calls/start`
  - Creates session in `initiated`.
- `POST /api/calls/:id/events`
  - Ingests realtime event; can move `initiated -> active` and `active -> closing -> closed`.
- `POST /api/calls/:id/handoff`
  - Transitions to `handoff_pending` through `escalated` path and returns `call.handoff_requested` envelope.
- `POST /api/calls/:id/postcall`
  - Allowed only after `closed`.
  - Returns generated `call.post_summary_ready` envelope.
- `GET /api/calls/:id/transcript`
  - Returns committed transcript and session state snapshot for debugging.

## State and invariants

- Terminal states: `closed`, `failed`.
- `postcall` generation requires `closed`.
- Sequence must increase when present.
- Duplicate `event_id` is rejected.
- Missing effective correlation id is rejected.
- `handed_off` blocks assistant turns in event processor.

## Testing strategy

- Unit tests for transition matrix guard behavior.
- HTTP-level tests via `fastify.inject`:
  - Valid progression `initiated -> active -> closing -> closed`.
  - Duplicate event rejection on second ingest.
  - Handoff endpoint progression and envelope correctness.
  - Assistant event rejection after `handed_off`.

## Non-goals

- Media transport, ASR/TTS pipelines, tool execution runtime, queue worker retry loops, persistence/database layer.


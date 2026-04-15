# Architecture Notes

## System split

The runtime separates media-plane and control-plane responsibilities:

- Media plane
  - receives/sends audio frames
  - performs ASR/TTS streaming
  - measures jitter, packet loss, and end-to-end turn latency
- Control plane
  - maintains call session state machine
  - orchestrates tool calls and handoff transitions
  - emits durable events for transcript and post-call workflows

## Core components

1. Session gateway
   - accepts call start and auth context
   - allocates `call_id` and correlation ids
2. Realtime orchestrator
   - handles partial/final transcript segments
   - decides assistant turn boundaries
3. Policy engine
   - enforces interruption and escalation policy
4. Handoff broker
   - creates human transfer requests
   - tracks accept/decline/timeouts
5. Event sink
   - persists ordered call events for replay
6. Post-call worker
   - builds summary payload and dispatches integrations

## Latency-critical path

`audio_in -> partial_asr -> turn_decision -> response_start`

Instrument at each segment with monotonic timestamps. Regression gates should fail when p95 response start latency exceeds configured target.

## Data contract entrypoints

- start call: `examples/call-start.json`
- realtime events: `examples/realtime-event.json`
- handoff: `examples/handoff-event.json`
- post-call summary: `examples/postcall-summary.json`

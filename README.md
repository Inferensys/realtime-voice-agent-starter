# realtime-voice-agent-starter

Technical starter for low-latency voice agents with explicit turn-taking rules, session state management, human handoff contracts, and post-call event pipelines.

This repository is optimized for teams building voice workflows where correctness of call transitions and event contracts matters as much as transcription quality.

## What is included

- `docs/architecture.md`: media/control plane split and latency-critical path
- `docs/session-state-machine.md`: allowed call states and transitions
- `docs/integration-contracts.md`: webhook and downstream contract definitions
- `docs/validation-matrix.md`: callflow validation matrix and failure drills
- `examples/*.json`: reference payloads for call/session events
- `policies/*.yaml`: turn and handoff policy profiles
- `configs/agent.example.toml`: runtime configuration baseline
- `assets/README.md`: placeholder captures for waveform/call timeline output

## Reference endpoints

- `POST /api/calls/start`
- `POST /api/calls/{id}/events`
- `POST /api/calls/{id}/handoff`
- `GET /api/calls/{id}/transcript`
- `POST /api/calls/{id}/postcall`

See `examples/call-start.json`, `examples/realtime-event.json`, and `examples/handoff-event.json`.

## Runtime characteristics

- Bidirectional audio stream with partial ASR events.
- Interrupt handling via explicit barge-in policy.
- Tool calls emitted as structured events, not inline free text.
- Handoff transition preserves transcript pointer and conversation state.
- Post-call summary event produced only from committed final transcript.

## Validation focus

- state transition correctness under packet jitter
- deterministic handoff semantics
- duplicate event suppression with idempotency keys
- transcript consistency between partial and final segments

The scenario matrix is in `docs/validation-matrix.md`.

## Demo workflow

1. Start call with `examples/call-start.json`.
2. Stream input and assistant events using `examples/realtime-event.json`.
3. Trigger escalation using `examples/handoff-event.json`.
4. Emit `examples/postcall-summary.json` after call close.

## Operational notes

- Keep per-call correlation ids across media/control logs.
- Store turn-level timing to support latency regression testing.
- Enforce participant role permissions for transfer and closure actions.

## Assets

Use filenames and capture guidance from `assets/README.md`.

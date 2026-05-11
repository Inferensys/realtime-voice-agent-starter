# Eval Guide

Voice evals are regression tests for call behavior.

Run the default suite:

```bash
npm run eval
```

Run with JSON output:

```bash
npm run eval -- --json
```

## Default Scenarios

| Scenario | What it catches |
| --- | --- |
| `standard-intake` | Transcript commits and clean call closure |
| `barge-in` | Caller interruption creates a cancellation marker |
| `silence-timeout` | No-response recovery path exists |
| `duplicate-event` | Duplicate event ids are detectable |
| `slow-model` | First-audio latency is measured |
| `tool-failure` | Tool failures remain recoverable |
| `handoff` | Transfer reaches `handed_off` |
| `postcall-webhook` | Post-call event emits once |

## When To Add Evals

Add a scenario when you change:

- Provider adapter mapping
- Turn-taking policy
- Handoff policy
- Tool-call behavior
- Prompt flow
- Post-call workflow
- Latency budgets

## CI Rule

Do not ship a voice-agent change only because TypeScript passes. Run evals too.

```bash
npm run typecheck
npm test
npm run eval
```

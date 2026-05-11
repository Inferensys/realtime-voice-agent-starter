# Contributing

This repo is for reusable voice-agent infrastructure: events, adapters, evals, examples, and control-plane behavior.

## Before Opening A PR

Run:

```bash
npm run typecheck
npm test
npm run eval
```

## Adapter PRs

Provider adapter changes need:

- One real provider payload fixture in a test.
- A normalized event assertion.
- README update in `examples/<provider-or-workflow>`.
- No provider secrets committed.

## Eval PRs

Eval changes should explain the production failure they catch. Keep scenarios short and deterministic.

## Style

- Keep contracts boring.
- Keep provider-specific behavior inside adapters.
- Keep examples runnable from the root repo.
- Prefer structured events over free-text logs.

# Implementation Plan

The repo is now organized as a kit:

- Core runtime contracts in `packages/core`
- Fastify control plane in `packages/server`
- Provider event adapters in `packages/adapters`
- Voice eval runner in `packages/evals`
- Local dev console in `apps/dev-console`
- Provider/workflow examples in `examples`

## Next Implementation Steps

1. Add provider session bootstrap code for the examples that need credentials.
2. Replace in-memory sessions with SQLite or Postgres when running multiple server processes.
3. Add real audio fixture replay for adapter regression tests.
4. Add per-provider latency fixtures.
5. Add package publishing workflow once package names are final.

## Non-goals

- Hosted SaaS platform.
- Provider credential management UI.
- Browser-token minting for every provider.
- Full CRM/ticketing integrations.

Those belong in product apps built on top of the kit.

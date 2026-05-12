# Support Escalation

Workflow example for explicit human handoff.

The script starts a call, commits a final caller transcript, requests handoff through the control-plane handoff route, records a `handoff.accepted` event, then prints replay output.

## Run

Terminal 1:

```bash
cp examples/support-escalation/.env.example examples/support-escalation/.env
npm run dev
```

Terminal 2:

```bash
node examples/support-escalation/run.mjs
```

Use `--dry-run` to inspect the generated payloads without calling the server:

```bash
node examples/support-escalation/run.mjs --dry-run
```

Options:

- `VOICE_API_BASE_URL` or `--base-url=http://127.0.0.1:8000`
- `CALL_ID` or `--call-id=call_support_escalation_demo`
- `HANDOFF_QUEUE=support-specialist`

The handoff keeps the last transcript pointer and blocks assistant turns after a human accepts the call.

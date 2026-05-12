# Post-call Webhook

Workflow example for CRM, ticketing, analytics, and QA pipelines.

The script starts a call, emits final transcript events, closes the call, requests a post-call summary from the control plane, and optionally POSTs the summary envelope to CRM and ticketing webhook URLs.

## Run

Terminal 1:

```bash
cp examples/postcall-webhook/.env.example examples/postcall-webhook/.env
npm run dev
```

Terminal 2:

```bash
node examples/postcall-webhook/run.mjs
```

Use `--dry-run` to inspect the generated payloads without calling the server:

```bash
node examples/postcall-webhook/run.mjs --dry-run
```

Options:

- `VOICE_API_BASE_URL` or `--base-url=http://127.0.0.1:8000`
- `CALL_ID` or `--call-id=call_postcall_webhook_demo`
- `CRM_WEBHOOK_URL` to receive the post-call summary envelope
- `TICKETING_WEBHOOK_URL` to receive the post-call summary envelope

Post-call output is allowed only after a call reaches `closed`.

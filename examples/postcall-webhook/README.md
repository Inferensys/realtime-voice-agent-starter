# Post-call Webhook

Workflow example for CRM, ticketing, analytics, and QA pipelines.

## Run

```bash
npm run dev
curl -s http://127.0.0.1:8000/api/calls/start -H 'content-type: application/json' -d @examples/call-start.json
curl -s http://127.0.0.1:8000/api/calls/call_01JBRX2W2B5P4Z11/events -H 'content-type: application/json' -d @examples/realtime-event.json
curl -s http://127.0.0.1:8000/api/calls/call_01JBRX2W2B5P4Z11/events -H 'content-type: application/json' -d @examples/call-closing.json
curl -s http://127.0.0.1:8000/api/calls/call_01JBRX2W2B5P4Z11/events -H 'content-type: application/json' -d @examples/call-closed.json
curl -s http://127.0.0.1:8000/api/calls/call_01JBRX2W2B5P4Z11/postcall -H 'content-type: application/json' -d @examples/postcall-summary.json
```

Post-call output is allowed only after a call reaches `closed`.

# Support Escalation

Workflow example for explicit human handoff.

## Run

```bash
npm run dev
curl -s http://127.0.0.1:8000/api/calls/start -H 'content-type: application/json' -d @examples/call-start.json
curl -s http://127.0.0.1:8000/api/calls/call_01JBRX2W2B5P4Z11/events -H 'content-type: application/json' -d @examples/realtime-event.json
curl -s http://127.0.0.1:8000/api/calls/call_01JBRX2W2B5P4Z11/handoff -H 'content-type: application/json' -d @examples/handoff-event.json
```

The handoff keeps the last transcript pointer and blocks assistant turns after a human accepts the call.

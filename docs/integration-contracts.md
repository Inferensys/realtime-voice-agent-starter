# Integration Contracts

Downstream systems should receive normalized events, not provider payloads.

## Envelope

```json
{
  "event_id": "evt_...",
  "event_type": "postcall.ready",
  "occurred_at": "2026-05-12T10:00:00.000Z",
  "call_id": "call_...",
  "correlation_id": "corr_...",
  "payload": {}
}
```

## Handoff

`handoff.requested`

Required payload:

- `requested_by`
- `reason_code`
- `last_transcript_seq`
- `target_queue`

`handoff.accepted`

Required payload:

- `agent_id`
- `accept_time`
- `handoff_latency_ms`
- `context_snapshot_uri`

## Post-call

`postcall.ready`

Required payload:

- `summary_version`
- `summary_text`
- `final_disposition`
- `action_items`
- `integration_targets`

## Delivery Semantics

- At-least-once delivery.
- Idempotency by `event_id`.
- Retry with exponential backoff.
- Dead-letter after configured retry limit.

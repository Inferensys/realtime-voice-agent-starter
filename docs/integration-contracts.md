# Integration Contracts

This file defines control-plane events emitted to downstream systems.

## Event envelope

All integration events follow:

```json
{
  "event_id": "evt_...",
  "event_type": "call.closed",
  "occurred_at": "2026-04-15T14:42:15Z",
  "call_id": "call_...",
  "correlation_id": "corr_...",
  "payload": {}
}
```

## `call.handoff_requested`

Required payload fields:

- `requested_by`
- `reason_code`
- `last_transcript_seq`
- `target_queue`

## `call.handed_off`

Required payload fields:

- `agent_id`
- `accept_time`
- `handoff_latency_ms`
- `context_snapshot_uri`

## `call.closed`

Required payload fields:

- `duration_ms`
- `turn_count`
- `final_disposition`
- `transcript_uri`

## `call.post_summary_ready`

Required payload fields:

- `summary_version`
- `summary_text`
- `action_items`
- `integration_targets`

## Delivery semantics

- at-least-once delivery
- idempotency by `event_id`
- retry with exponential backoff
- dead-letter after `max_retries`

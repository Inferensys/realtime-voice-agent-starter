# Validation Matrix

These are the minimum callflow checks for this kit.

| Scenario | Fault | Expected result |
| --- | --- | --- |
| Standard intake | None | `initiated -> active -> closing -> closed`, final transcript committed, post-call event emitted once |
| Barge-in | Caller interrupts assistant audio | Assistant output is canceled, `turn.interrupted` is recorded, next caller transcript wins |
| Human escalation | Low confidence or explicit transfer request | `active -> escalated -> handoff_pending -> handed_off`, handoff keeps last transcript pointer |
| Duplicate event | Same `event_id` replayed | Second event rejected, transcript not duplicated |
| Out-of-order event | Lower or equal sequence number arrives | Event rejected with sequence error |
| Tool failure | Tool times out or throws | `tool.result` carries error, call can continue |
| Slow model | First audio exceeds budget | `latency.marker` records the miss |
| Post-call timeout | Downstream webhook times out | Call remains closed, post-call event can retry idempotently |

Required artifacts per scenario:

- call start payload
- normalized event stream
- transcript snapshot
- replay output
- handoff payload if escalated
- post-call payload when closed

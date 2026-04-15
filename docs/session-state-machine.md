# Session State Machine

## States

- `initiated`
- `active`
- `escalated`
- `handoff_pending`
- `handed_off`
- `closing`
- `closed`
- `failed`

## Allowed transitions

- `initiated -> active`
- `active -> escalated`
- `escalated -> handoff_pending`
- `handoff_pending -> handed_off`
- `active -> closing`
- `handed_off -> closing`
- `closing -> closed`
- any non-terminal state -> `failed`

## Transition invariants

- `closed` and `failed` are terminal.
- `handed_off` forbids assistant-generated turns.
- `post_call_summary` can only emit after `closed`.
- transcript sequence numbers must be strictly increasing within a call.

## Error conditions

- Invalid transition: reject with `409 invalid_state_transition`.
- Missing correlation id: reject with `400 missing_correlation_id`.
- Out-of-order event sequence: reject with `422 invalid_sequence`.

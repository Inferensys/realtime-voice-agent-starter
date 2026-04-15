# Validation Matrix

This document defines deterministic callflow tests for latency, state correctness, and handoff reliability.

## Scenario 1: Standard intake call

- Entry: `call.requested`
- Flow: greeting -> caller intent capture -> structured summary
- Expected result:
  - state progression `initiated -> active -> closing -> closed`
  - no handoff
  - post-call summary emitted once

## Scenario 2: Barge-in handling

- Fault injection: caller interrupts assistant mid-response
- Expected result:
  - assistant audio chunk canceled
  - state remains `active`
  - next turn contains caller transcript with interruption marker

## Scenario 3: Human escalation

- Trigger: confidence below threshold or explicit transfer request
- Expected result:
  - state progression `active -> escalated -> handoff_pending -> handed_off`
  - handoff payload includes last committed transcript pointer
  - no assistant responses after handoff completion

## Scenario 4: Duplicate realtime events

- Fault injection: replay same `event_id` twice
- Expected result:
  - second event rejected as duplicate
  - no duplicated transcript segments
  - monotonic sequence number validation preserved

## Scenario 5: Post-call pipeline timeout

- Fault injection: downstream CRM webhook times out
- Expected result:
  - call remains `closed`
  - post-call event retried with exponential backoff
  - dead-letter record created after retry limit

## Required artifacts per scenario

- call start payload
- realtime event stream sample
- handoff payload if escalated
- terminal transcript sample
- post-call summary payload

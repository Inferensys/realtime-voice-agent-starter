# Event Model

Provider events are noisy. The kit normalizes them into a small set of voice-agent events.

## Event Envelope

```json
{
  "event_id": "evt_...",
  "call_id": "call_...",
  "provider": "openai-realtime",
  "type": "transcript.final",
  "timestamp": "2026-05-12T10:00:00.000Z",
  "sequence": 3,
  "correlation_id": "corr_...",
  "payload": {}
}
```

## Event Types

| Type | Meaning |
| --- | --- |
| `audio.input` | User or phone audio received |
| `audio.output` | Assistant audio emitted |
| `transcript.partial` | Non-final transcript segment |
| `transcript.final` | Committed transcript segment |
| `tool.call` | Assistant requested a tool |
| `tool.result` | Tool completed or failed |
| `turn.interrupted` | Caller interrupted assistant output |
| `handoff.requested` | Voice agent requested human transfer |
| `handoff.accepted` | Human accepted transfer |
| `call.activated` | Call moved into active state |
| `call.closing` | Call is closing |
| `call.closed` | Call closed cleanly |
| `call.failed` | Call failed |
| `postcall.ready` | Post-call payload is ready |
| `latency.marker` | Timing measurement |

## Transcript Payload

```json
{
  "speaker": "caller",
  "text": "I need to change my appointment.",
  "confidence": 0.96,
  "is_final": true
}
```

## Tool Payload

```json
{
  "tool_call_id": "tool_123",
  "tool_name": "lookup_appointment",
  "arguments": {
    "caller": "+15555550100"
  }
}
```

Tool results use the same `tool_call_id`:

```json
{
  "tool_call_id": "tool_123",
  "result": {
    "appointment": "Friday 2:30 PM"
  }
}
```

Failures stay structured:

```json
{
  "tool_call_id": "tool_123",
  "error": "timeout"
}
```

## Latency Payload

```json
{
  "name": "first-audio",
  "value_ms": 420,
  "budget_ms": 900
}
```

## Compatibility

The server still accepts the original `call.handoff_requested`, `call.handed_off`, and `call.post_summary_ready` names and normalizes them internally.

# LiveKit Room Agent

Room-participant voice agent path for LiveKit. This example shows how a room agent can translate LiveKit room, transcript, latency, and handoff events into the kit's normalized model and control-plane routes.

## Smoke Mode

```bash
node examples/livekit-room-agent/run.mjs
```

The default command needs no LiveKit credentials and does not require the local server. It prints:

- a sample `POST /api/calls/start` payload
- sample LiveKit room-agent events
- normalized `audio.input`, `transcript.partial`, `transcript.final`, and `handoff.requested` events
- the webhook, normalized event, handoff, and replay routes

## Post Through The Control Plane

In another shell, start the starter API:

```bash
npm run dev
```

Then replay the sample provider events into the webhook adapter:

```bash
node examples/livekit-room-agent/run.mjs --post
```

The script calls `POST /api/calls/start`, sends each raw LiveKit event to `POST /api/webhooks/livekit`, and prints the final `GET /api/calls/:id/replay` result.

For production handoff workflows, map the LiveKit handoff event into the handoff request shape and call `POST /api/calls/:id/handoff`; the script prints that route in smoke mode.

## Use Captured Events

Pass either a single JSON event, a JSON array, or `{ "events": [...] }`:

```bash
node examples/livekit-room-agent/run.mjs --input ./livekit-events.json
node examples/livekit-room-agent/run.mjs --input ./livekit-events.json --post --base-url http://127.0.0.1:8000
```

Real LiveKit credentials are only needed by the room agent that joins the room. This bridge script accepts already-captured room events and keeps credentials out of the replay path.

## Mapping

| LiveKit room-agent shape | Normalized event |
| --- | --- |
| audio track or room activity event | `audio.input` |
| `event` or `type` containing `transcript`, `is_final: false` | `transcript.partial` |
| `event` or `type` containing `transcript`, `is_final: true` | `transcript.final` |
| `event` or `type` containing `handoff` | `handoff.requested` |
| `event` or `type` containing `latency` | `latency.marker` |

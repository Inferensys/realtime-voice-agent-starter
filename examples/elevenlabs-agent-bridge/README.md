# ElevenLabs Agent Bridge

Bridge ElevenLabs realtime conversation events into the kit's normalized event model and control-plane webhook.

## Smoke Mode

```bash
node examples/elevenlabs-agent-bridge/run.mjs
```

The default command needs no ElevenLabs credentials and does not require the local server. It prints:

- a sample `POST /api/calls/start` payload
- sample ElevenLabs conversation events
- normalized caller transcript, assistant transcript, and audio output events
- the control-plane routes that would receive the events

## Post Through The Control Plane

In another shell, start the starter API:

```bash
npm run dev
```

Then replay the sample provider events into the webhook adapter:

```bash
node examples/elevenlabs-agent-bridge/run.mjs --post
```

The script calls `POST /api/calls/start`, sends each raw ElevenLabs event to `POST /api/webhooks/elevenlabs`, and prints the final `GET /api/calls/:id/replay` result.

## Use Captured Events

Pass either a single JSON event, a JSON array, or `{ "events": [...] }`:

```bash
node examples/elevenlabs-agent-bridge/run.mjs --input ./elevenlabs-events.json
node examples/elevenlabs-agent-bridge/run.mjs --input ./elevenlabs-events.json --post --base-url http://127.0.0.1:8000
```

Real ElevenLabs credentials are only needed by the process that receives conversation events. This bridge script accepts already-captured events and keeps credentials out of the replay path.

## Mapping

| ElevenLabs shape | Normalized event |
| --- | --- |
| `type` containing `user_transcript` | `transcript.final` with `speaker: "caller"` |
| `type` containing `agent_response` | `transcript.final` with `speaker: "assistant"` |
| `type` containing `audio` | `audio.output` |
| unknown conversation event | `audio.output` with the raw provider payload preserved |

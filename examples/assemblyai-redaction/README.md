# AssemblyAI Redaction

Streaming transcription path with redaction-friendly payloads. This example maps AssemblyAI transcript messages into the kit's normalized transcript events while preserving redaction metadata under `payload.redacted`.

## Smoke Mode

```bash
node examples/assemblyai-redaction/run.mjs
```

The default command needs no AssemblyAI credentials and does not require the local server. It prints:

- a sample `POST /api/calls/start` payload
- sample AssemblyAI partial and final transcript messages
- normalized `transcript.partial` and `transcript.final` events
- redaction metadata preserved beside the transcript

## Post Through The Control Plane

In another shell, start the starter API:

```bash
npm run dev
```

Then replay the sample provider events into the webhook adapter:

```bash
node examples/assemblyai-redaction/run.mjs --post
```

The script calls `POST /api/calls/start`, sends each raw AssemblyAI event to `POST /api/webhooks/assemblyai`, and prints the final `GET /api/calls/:id/replay` result.

## Use Captured Events

Pass either a single JSON event, a JSON array, or `{ "events": [...] }`:

```bash
node examples/assemblyai-redaction/run.mjs --input ./assemblyai-events.json
node examples/assemblyai-redaction/run.mjs --input ./assemblyai-events.json --post --base-url http://127.0.0.1:8000
```

Real AssemblyAI credentials are only needed by the streaming transcription process. This bridge script accepts already-captured events and keeps credentials out of the replay path.

## Mapping

| AssemblyAI shape | Normalized event |
| --- | --- |
| `message_type: "PartialTranscript"` or `end_of_turn: false` | `transcript.partial` |
| `message_type: "FinalTranscript"` or `end_of_turn: true` | `transcript.final` |
| `text` or `transcript` | `payload.text` |
| `confidence` | `payload.confidence` |
| `redacted` | `payload.redacted` |

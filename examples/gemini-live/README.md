# Gemini Live

Realtime voice and multimodal path for Gemini Live. This example shows how to map Gemini Live server events into the kit's normalized voice event model, then optionally send the same raw events through the control plane webhook.

## Smoke Mode

```bash
node examples/gemini-live/run.mjs
```

The default command needs no Google credentials and does not require the local server. It prints:

- a sample `POST /api/calls/start` payload
- sample Gemini Live provider events
- normalized `transcript.final`, `transcript.partial`, `turn.interrupted`, and `audio.output` events
- the control-plane routes that would receive the events

## Post Through The Control Plane

In another shell, start the starter API:

```bash
npm run dev
```

Then replay the sample provider events into the webhook adapter:

```bash
node examples/gemini-live/run.mjs --post
```

The script calls `POST /api/calls/start`, sends each raw Gemini event to `POST /api/webhooks/gemini-live`, and prints the final `GET /api/calls/:id/replay` result.

## Use Captured Events

Pass either a single JSON event, a JSON array, or `{ "events": [...] }`:

```bash
node examples/gemini-live/run.mjs --input ./gemini-events.json
node examples/gemini-live/run.mjs --input ./gemini-events.json --post --base-url http://127.0.0.1:8000
```

Real Gemini credentials are only needed by the process that captures Live API events. This bridge script accepts already-captured events and keeps credentials out of the replay path.

## Mapping

| Gemini Live shape | Normalized event |
| --- | --- |
| `serverContent.inputTranscription.text` | `transcript.final` with `speaker: "caller"` |
| `serverContent.outputTranscription.text` | `transcript.partial` with `speaker: "assistant"` |
| `serverContent.interrupted` | `turn.interrupted` |
| `serverContent.modelTurn.parts[].inlineData` | `audio.output` |

# Chained STT + LLM + TTS Pipeline

Runnable local example for a composable voice pipeline:

```text
Deepgram or AssemblyAI -> text model -> Cartesia or ElevenLabs
```

The script starts a call in the Fastify control plane, emits normalized STT transcript events, emits a model tool decision, records the tool result, then emits normalized TTS audio events and prints replay output.

## Run

Terminal 1:

```bash
cp examples/chained-pipeline/.env.example examples/chained-pipeline/.env
npm run dev
```

Terminal 2:

```bash
node examples/chained-pipeline/run.mjs
```

Use `--dry-run` to inspect the generated payloads without calling the server:

```bash
node examples/chained-pipeline/run.mjs --dry-run
```

Options:

- `VOICE_API_BASE_URL` or `--base-url=http://127.0.0.1:8000`
- `CALL_ID` or `--call-id=call_chained_pipeline_demo`

Use this pattern when you do not want a speech-to-speech model to own the full turn.

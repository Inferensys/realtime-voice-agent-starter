# Chained STT + LLM + TTS Pipeline

Composable voice pipeline path:

```text
Deepgram or AssemblyAI -> text model -> Cartesia or ElevenLabs
```

## Run

```bash
cp examples/chained-pipeline/.env.example examples/chained-pipeline/.env
npm run dev
```

Use this when you do not want a speech-to-speech model to own the full turn.

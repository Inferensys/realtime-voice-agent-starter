# Azure OpenAI Realtime

Server-side realtime voice path for Azure OpenAI.

Use this when your backend owns the API key and you want a simple WebSocket path for batch audio, call recordings, or server-side telephony bridges. For browser microphones, use WebRTC and issue ephemeral tokens from your backend.

## Run

```bash
cp examples/azure-openai-realtime/.env.example examples/azure-openai-realtime/.env
npm run build
set -a && source examples/azure-openai-realtime/.env && set +a
node examples/azure-openai-realtime/run.mjs docs/demo/dataset/audio/minds14_1.wav
```

The script converts the WAV file to 24 kHz PCM16 with `ffmpeg`, streams it to the realtime deployment, and prints the model transcript plus generated audio byte count.

Use the `azure-openai-realtime` adapter when your app needs Azure networking, deployment names, enterprise tenancy controls, or the same normalized event surface as OpenAI Realtime.

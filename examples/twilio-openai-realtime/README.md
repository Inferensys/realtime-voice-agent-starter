# Twilio + OpenAI Realtime

Phone-call path for Twilio Media Streams.

This example gives you the telephony edge most teams need first: Twilio streams
call audio over WebSocket, the server maps provider frames into the kit's event
model, and the control plane keeps a replayable call timeline. From there you can
bridge the same media frames into OpenAI Realtime, Azure OpenAI Realtime, or a
chained STT/LLM/TTS pipeline.

## Run

```bash
cp examples/twilio-openai-realtime/.env.example examples/twilio-openai-realtime/.env
npm run dev
```

In another terminal:

```bash
node examples/twilio-openai-realtime/server.mjs
```

Expose the example server:

```bash
ngrok http 8788
```

Set `PUBLIC_BASE_URL` to the ngrok HTTPS origin, then point your Twilio Voice
webhook at:

```text
POST https://your-ngrok-host/twiml
```

The returned TwiML connects the call to:

```text
wss://your-ngrok-host/media
```

The Twilio adapter maps `start`, `media`, `mark`, and `stop` into the normalized event model.

## Local smoke test

```bash
node examples/twilio-openai-realtime/server.mjs --sample
```

That sends a short synthetic Twilio event sequence through the same webhook path
and prints the replay summary.

## Notes

- Twilio sends mu-law 8 kHz audio frames. Realtime model bridges usually need a
  small codec/resampling step before forwarding audio to a model.
- This example keeps the Twilio edge and the normalized event timeline explicit.
  Use `examples/azure-openai-realtime` for the direct realtime model audio path.

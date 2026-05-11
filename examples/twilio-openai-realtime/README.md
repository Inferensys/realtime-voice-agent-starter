# Twilio + OpenAI Realtime

Phone-call path for Twilio Media Streams and OpenAI Realtime.

## Run

```bash
cp examples/twilio-openai-realtime/.env.example examples/twilio-openai-realtime/.env
npm run dev
```

Point the Twilio stream webhook at:

```text
POST /api/webhooks/twilio-media-streams
```

The Twilio adapter maps `start`, `media`, `mark`, and `stop` into the normalized event model.

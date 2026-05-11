---
name: Provider adapter request
about: Request support for a realtime voice, STT, TTS, WebRTC, or telephony provider.
title: "Adapter: "
labels: adapter
---

## Provider

Name and docs URL:

## Event shapes needed

Paste a redacted sample payload:

```json
{}
```

## Expected normalized events

- `audio.input`
- `audio.output`
- `transcript.partial`
- `transcript.final`
- `tool.call`
- `tool.result`
- `turn.interrupted`
- `handoff.requested`
- `handoff.accepted`
- `latency.marker`

## Notes

Anything unusual about auth, streaming, reconnects, or payload ordering?

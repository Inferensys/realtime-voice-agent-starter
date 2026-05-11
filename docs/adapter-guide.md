# Adapter Guide

Adapters keep provider-specific event shapes out of the application.

## Contract

```ts
import { SpeechModelAdapter, NormalizedVoiceEvent } from "@inferensys/realtime-voice";

export class MyProviderAdapter implements SpeechModelAdapter {
  provider = "fake" as const;

  normalizeProviderEvent(raw: unknown, callId: string): NormalizedVoiceEvent[] {
    return [];
  }
}
```

## Rules

- Emit normalized events only.
- Preserve provider payloads under `payload.raw` when the mapping is unclear.
- Do not run tool handlers inside adapters.
- Do not mutate session state inside adapters.
- Generate stable event ids when the provider gives you one.
- Keep audio bytes opaque. The control plane should not need to decode provider audio to enforce state rules.

## Launch Adapters

| Adapter | Input shape handled |
| --- | --- |
| `fake` | Local normalized or legacy events |
| `openai-realtime` | Realtime audio, transcript, interruption, and tool-call events |
| `azure-openai-realtime` | Same normalized surface as OpenAI Realtime |
| `gemini-live` | Live API transcript, interruption, and output events |
| `twilio-media-streams` | `start`, `media`, `mark`, and `stop` |
| `livekit` | Transcript and handoff-style events |
| `deepgram` | Streaming STT results |
| `elevenlabs` | User transcript, agent response, and audio events |
| `cartesia` | Streaming TTS chunks |
| `assemblyai` | Streaming transcript and redaction payloads |

## Adding A Provider

1. Add the provider name to `providerNameSchema` in `@inferensys/realtime-voice`.
2. Add an adapter class in `@inferensys/realtime-voice-adapters`.
3. Add a contract test that maps one real provider payload into a normalized event.
4. Add an example directory with `.env.example` and README.
5. Add a short row to the provider matrix in the root README.

# Azure Realtime Audio Demo Output

Dataset: [PolyAI/minds14](https://huggingface.co/datasets/PolyAI/minds14) (cc-by-4.0)

Realtime deployment: gpt-realtime-1.5

Response model: gpt-realtime-1.5-2026-02-23

Generated at: 2026-05-12T07:00:21.389Z

## What Ran

The script streamed real WAV audio clips to Azure OpenAI Realtime over WebSocket, captured model audio output plus the output transcript, then replayed concise normalized events through the local Fastify control plane.

## Summary

- Calls processed: 4
- Realtime server events received: 298
- Control-plane events emitted: 32
- Model audio bytes generated: 1584000

## Calls

| Call | Model | Realtime events | Output audio bytes | Model response |
| --- | --- | ---: | ---: | --- |
| call_minds14_1 | gpt-realtime-1.5-2026-02-23 | 71 | 362400 | To open a joint account, you'll usually both need to provide ID, visit your bank (online or in person), and sign the application together. [queue: account_opening] |
| call_minds14_2 | gpt-realtime-1.5-2026-02-23 | 88 | 460800 | To open a joint account with your wife, you'll usually start in your bank’s mobile app or website under "Open Account" and select "Joint"; if you need help, a banker can guide you. [queue: account_opening] |
| call_minds14_3 | gpt-realtime-1.5-2026-02-23 | 71 | 403200 | I can guide you through the process, but you’ll need to speak with our account-opening team to securely provide details over the phone. [queue: account_opening] |
| call_minds14_4 | gpt-realtime-1.5-2026-02-23 | 68 | 357600 | To start a joint account, you’ll both need to provide identification and personal details at your bank or via an online application form. [queue: account_opening] |

## Control-Plane Event Counts

```json
{
  "audio.input": 4,
  "audio.output": 4,
  "call.closed": 4,
  "call.closing": 4,
  "latency.marker": 4,
  "postcall.ready": 4,
  "transcript.final": 8
}
```

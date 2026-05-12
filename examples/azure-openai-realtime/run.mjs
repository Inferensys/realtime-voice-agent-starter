import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runAzureRealtimeAudioTurn } = require("../../packages/adapters/dist/index.js");

const audioPath = process.argv[2];
if (!audioPath) {
  throw new Error("Usage: node examples/azure-openai-realtime/run.mjs <path-to-wav>");
}

const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? process.env.OPENAI_BASE_URL;
const apiKey = process.env.AZURE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
const deployment = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT ?? process.env.OPENAI_REALTIME_MODEL;

if (!endpoint || !apiKey || !deployment) {
  throw new Error("Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_REALTIME_DEPLOYMENT.");
}

const inputPcm16 = execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  audioPath,
  "-f",
  "s16le",
  "-acodec",
  "pcm_s16le",
  "-ac",
  "1",
  "-ar",
  "24000",
  "pipe:1"
], { maxBuffer: 20 * 1024 * 1024 });

const result = await runAzureRealtimeAudioTurn({
  endpoint,
  deployment,
  apiKey,
  inputPcm16,
  instructions:
    "You are a practical support voice agent. Listen to the caller and answer with the next safe step.",
  responseInstructions:
    "Reply in one short sentence. Include the likely routing queue in square brackets as [queue: queue_name]."
});

console.log(JSON.stringify({
  deployment: result.deployment,
  model: result.model,
  input_audio_bytes: result.inputAudioBytes,
  output_audio_bytes: result.outputAudioBytes,
  realtime_events: result.rawEvents.length,
  transcript: result.outputTranscript
}, null, 2));

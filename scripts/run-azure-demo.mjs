import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const demoDir = join(root, "docs", "demo");
const datasetDir = join(demoDir, "dataset");
const audioDir = join(datasetDir, "audio");
const outputDir = join(demoDir, "output");
const responseAudioDir = join(outputDir, "responses");

const datasetUrl =
  "https://datasets-server.huggingface.co/rows?dataset=PolyAI%2Fminds14&config=en-US&split=train&offset=0&length=4";
const defaultBaseUrl = "https://chainscore-team-resource.services.ai.azure.com/openai/v1";
const defaultRealtimeDeployment = "gpt-realtime-1.5";

function getAzureKeyFromCli() {
  const resourceGroup = process.env.AZURE_AI_RESOURCE_GROUP;
  const resourceName = process.env.AZURE_AI_RESOURCE_NAME;
  if (!resourceGroup || !resourceName) {
    return undefined;
  }
  try {
    return execFileSync(
      "az",
      [
        "cognitiveservices",
        "account",
        "keys",
        "list",
        "-g",
        resourceGroup,
        "-n",
        resourceName,
        "--query",
        "key1",
        "-o",
        "tsv"
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return undefined;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  return JSON.parse(body);
}

async function downloadDataset() {
  const data = await fetchJson(datasetUrl);
  const rows = data.rows.map((item, index) => {
    const audio = Array.isArray(item.row.audio) ? item.row.audio[0] : undefined;
    return {
      id: `minds14_${index + 1}`,
      row_idx: item.row_idx,
      source_path: item.row.path,
      download_audio_url: audio?.src ?? null,
      audio_type: audio?.type ?? null,
      transcription: item.row.english_transcription ?? item.row.transcription,
      intent_class: item.row.intent_class,
      lang_id: item.row.lang_id
    };
  });

  await mkdir(audioDir, { recursive: true });
  for (const row of rows) {
    if (!row.download_audio_url) {
      continue;
    }
    const audioResponse = await fetch(row.download_audio_url);
    if (!audioResponse.ok) {
      continue;
    }
    const buffer = Buffer.from(await audioResponse.arrayBuffer());
    const audioPath = join(audioDir, `${row.id}.wav`);
    await writeFile(audioPath, buffer);
    row.local_audio = `docs/demo/dataset/audio/${row.id}.wav`;
    delete row.download_audio_url;
  }

  const dataset = {
    source: "PolyAI/minds14",
    source_url: "https://huggingface.co/datasets/PolyAI/minds14",
    license: "cc-by-4.0",
    config: "en-US",
    split: "train",
    rows
  };
  await writeFile(join(datasetDir, "minds14-en-us-sample.json"), `${JSON.stringify(dataset, null, 2)}\n`);
  return dataset;
}

function loadAdapterPackage() {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  return require(join(root, "packages", "adapters", "dist", "index.js"));
}

function convertWavToPcm16(audioPath) {
  return execFileSync(
    "ffmpeg",
    [
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
    ],
    { cwd: root, maxBuffer: 20 * 1024 * 1024 }
  );
}

function outputAudioFromEvents(rawEvents) {
  const chunks = [];
  for (const event of rawEvents) {
    if (event.type === "response.output_audio.delta" && typeof event.delta === "string") {
      chunks.push(Buffer.from(event.delta, "base64"));
    }
  }
  return Buffer.concat(chunks);
}

function countEventTypes(events) {
  const counts = {};
  for (const event of events) {
    const type = typeof event.type === "string" ? event.type : "unknown";
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

function wavFromPcm16(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  const dataSize = pcm.byteLength;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

async function runRealtimeTurns(dataset, adapterPackage) {
  const apiKey =
    process.env.OPENAI_API_KEY ??
    process.env.AZURE_OPENAI_API_KEY ??
    getAzureKeyFromCli();
  if (!apiKey) {
    throw new Error(
      "Missing Azure/OpenAI key. Set OPENAI_API_KEY, AZURE_OPENAI_API_KEY, or AZURE_AI_RESOURCE_GROUP + AZURE_AI_RESOURCE_NAME for az key lookup."
    );
  }

  const endpoint = (process.env.OPENAI_BASE_URL ?? process.env.AZURE_OPENAI_ENDPOINT ?? defaultBaseUrl).replace(/\/$/, "");
  const deployment =
    process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT ??
    process.env.OPENAI_REALTIME_MODEL ??
    defaultRealtimeDeployment;

  await mkdir(responseAudioDir, { recursive: true });
  const turns = [];

  for (const row of dataset.rows) {
    if (!row.local_audio) {
      throw new Error(`Dataset row ${row.id} did not include local audio.`);
    }
    const inputPath = join(root, row.local_audio);
    const inputPcm16 = convertWavToPcm16(inputPath);
    const result = await adapterPackage.runAzureRealtimeAudioTurn({
      endpoint,
      deployment,
      apiKey,
      inputPcm16,
      instructions:
        "You are a practical banking voice agent for account-opening support. The audio can be noisy. When the caller asks about a joint account, treat it as a bank account request, not a phone-call request. Do not ask for account numbers, card numbers, or secrets.",
      responseInstructions:
        "Reply in one short sentence. Include the likely routing queue in square brackets as [queue: queue_name]. Use [queue: account_opening] for joint-account setup questions.",
      voice: process.env.AZURE_OPENAI_REALTIME_VOICE ?? "alloy",
      timeoutMs: Number(process.env.AZURE_OPENAI_REALTIME_TIMEOUT_MS ?? 45_000)
    });
    const responsePcm16 = outputAudioFromEvents(result.rawEvents);
    const responseAudioPath = `docs/demo/output/responses/call_${row.id}.response.wav`;
    await writeFile(join(root, responseAudioPath), wavFromPcm16(responsePcm16));

    turns.push({
      call_id: `call_${row.id}`,
      source_row: row,
      realtime: {
        endpoint_host: new URL(endpoint).host,
        deployment,
        model: result.model ?? deployment,
        duration_ms: result.durationMs,
        input_audio_bytes: result.inputAudioBytes,
        output_audio_bytes: result.outputAudioBytes,
        output_transcript: result.outputTranscript,
        raw_event_count: result.rawEvents.length,
        raw_event_counts: countEventTypes(result.rawEvents),
        response_audio_path: responseAudioPath
      }
    });
  }

  return turns;
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Server did not become healthy.");
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function event(callId, type, payload, provider = "azure-openai-realtime") {
  return {
    event_id: `evt_${callId}_${type.replaceAll(".", "_")}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    call_id: callId,
    provider,
    correlation_id: `corr_${callId}`,
    type,
    timestamp: new Date().toISOString(),
    payload
  };
}

function queueFromTranscript(transcript) {
  const match = transcript.match(/\[queue:\s*([^\]]+)\]/i);
  return match?.[1]?.trim() || "banking_support";
}

async function runControlPlane(turns) {
  const port = Number(process.env.DEMO_PORT ?? 8123);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn("node", ["packages/server/dist/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(port);
    const replays = [];
    for (const turn of turns) {
      const callId = turn.call_id;
      const queue = queueFromTranscript(turn.realtime.output_transcript);
      await postJson(baseUrl, "/api/calls/start", {
        call_id: callId,
        source: "minds14-azure-realtime-demo",
        caller: {
          phone_e164: `+155501${turn.source_row.id.replace("minds14_", "").padStart(4, "0")}`,
          locale: "en-US"
        },
        context: {
          tenant: "voice-kit-demo",
          queue,
          request_id: `corr_${callId}`
        },
        capabilities: {
          allow_handoff: true,
          allow_tool_calls: true
        }
      });

      const events = [
        event(callId, "audio.input", {
          source_audio_path: turn.source_row.local_audio,
          input_audio_bytes: turn.realtime.input_audio_bytes,
          format: { type: "audio/pcm", rate: 24000 },
          realtime_deployment: turn.realtime.deployment
        }),
        event(callId, "transcript.final", {
          speaker: "caller",
          text: turn.source_row.transcription,
          confidence: 1,
          is_final: true
        }, "fake"),
        event(callId, "latency.marker", {
          name: "user-stop-to-agent-start",
          value_ms: turn.realtime.duration_ms,
          budget_ms: 5000
        }),
        event(callId, "audio.output", {
          response_audio_path: turn.realtime.response_audio_path,
          output_audio_bytes: turn.realtime.output_audio_bytes,
          format: { type: "audio/pcm", rate: 24000 },
          realtime_model: turn.realtime.model
        }),
        event(callId, "transcript.final", {
          speaker: "assistant",
          text: turn.realtime.output_transcript,
          confidence: 1,
          is_final: true
        }),
        event(callId, "call.closing", {}),
        event(callId, "call.closed", {})
      ];

      for (const item of events) {
        await postJson(baseUrl, `/api/calls/${callId}/events`, item);
      }

      await postJson(baseUrl, `/api/calls/${callId}/postcall`, {
        summary_version: "v1",
        integration_targets: ["crm", "ticketing", "qa"]
      });

      const replay = await fetchJson(`${baseUrl}/api/calls/${callId}/replay`);
      replays.push({
        ...turn,
        replay
      });
    }
    return replays;
  } finally {
    server.kill("SIGTERM");
  }
}

function summarize(replays) {
  const eventCounts = new Map();
  for (const item of replays) {
    for (const eventItem of item.replay.events) {
      eventCounts.set(eventItem.type, (eventCounts.get(eventItem.type) ?? 0) + 1);
    }
  }
  return {
    calls_processed: replays.length,
    control_plane_events: replays.reduce((sum, item) => sum + item.replay.events.length, 0),
    realtime_events: replays.reduce((sum, item) => sum + item.realtime.raw_event_count, 0),
    output_audio_bytes: replays.reduce((sum, item) => sum + item.realtime.output_audio_bytes, 0),
    event_counts: Object.fromEntries([...eventCounts.entries()].sort())
  };
}

function markdownReport(demo) {
  const rows = demo.replays.map((item) => {
    return `| ${item.call_id} | ${item.realtime.model} | ${item.realtime.raw_event_count} | ${item.realtime.output_audio_bytes} | ${item.realtime.output_transcript} |`;
  }).join("\n");

  return `# Azure Realtime Audio Demo Output

Dataset: [PolyAI/minds14](https://huggingface.co/datasets/PolyAI/minds14) (${demo.dataset.license})

Realtime deployment: ${demo.azure.deployment}

Response model: ${demo.azure.model}

Generated at: ${demo.generated_at}

## What Ran

The script streamed real WAV audio clips to Azure OpenAI Realtime over WebSocket, captured model audio output plus the output transcript, then replayed concise normalized events through the local Fastify control plane.

## Summary

- Calls processed: ${demo.summary.calls_processed}
- Realtime server events received: ${demo.summary.realtime_events}
- Control-plane events emitted: ${demo.summary.control_plane_events}
- Model audio bytes generated: ${demo.summary.output_audio_bytes}

## Calls

| Call | Model | Realtime events | Output audio bytes | Model response |
| --- | --- | ---: | ---: | --- |
${rows}

## Control-Plane Event Counts

\`\`\`json
${JSON.stringify(demo.summary.event_counts, null, 2)}
\`\`\`
`;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const dataset = await downloadDataset();
  const adapterPackage = loadAdapterPackage();
  const turns = await runRealtimeTurns(dataset, adapterPackage);
  const replays = await runControlPlane(turns);
  const first = replays[0]?.realtime;
  const demo = {
    generated_at: new Date().toISOString(),
    dataset,
    azure: {
      deployment: first?.deployment ?? defaultRealtimeDeployment,
      model: first?.model ?? defaultRealtimeDeployment,
      endpoint_host: first?.endpoint_host ?? new URL(defaultBaseUrl).host
    },
    replays,
    summary: summarize(replays)
  };
  await writeFile(join(demoDir, "azure-foundry-demo.json"), `${JSON.stringify(demo, null, 2)}\n`);
  await writeFile(join(demoDir, "azure-foundry-demo.md"), markdownReport(demo));
  await writeFile(join(outputDir, "replays.json"), `${JSON.stringify(replays, null, 2)}\n`);
  process.stdout.write(`Wrote ${join(demoDir, "azure-foundry-demo.json")}\n`);
  process.stdout.write(`Wrote ${join(demoDir, "azure-foundry-demo.md")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});

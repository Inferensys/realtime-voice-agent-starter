import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demoDir = join(root, "docs", "demo");
const datasetDir = join(demoDir, "dataset");
const audioDir = join(datasetDir, "audio");
const outputDir = join(demoDir, "output");

const datasetUrl =
  "https://datasets-server.huggingface.co/rows?dataset=PolyAI%2Fminds14&config=en-US&split=train&offset=0&length=4";
const defaultBaseUrl = "https://chainscore-team-resource.services.ai.azure.com/openai/v1";

function requiredEnv(name, fallback) {
  return process.env[name] ?? fallback;
}

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

function parseJsonBlock(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Model response did not contain JSON.");
    }
    return JSON.parse(match[0]);
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
      audio_url: audio?.src ?? null,
      audio_type: audio?.type ?? null,
      transcription: item.row.english_transcription ?? item.row.transcription,
      intent_class: item.row.intent_class,
      lang_id: item.row.lang_id
    };
  });

  await mkdir(audioDir, { recursive: true });
  for (const row of rows) {
    if (!row.audio_url) {
      continue;
    }
    const audioResponse = await fetch(row.audio_url);
    if (!audioResponse.ok) {
      continue;
    }
    const buffer = Buffer.from(await audioResponse.arrayBuffer());
    const audioPath = join(audioDir, `${row.id}.wav`);
    await writeFile(audioPath, buffer);
    row.local_audio = `docs/demo/dataset/audio/${row.id}.wav`;
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

async function callAzureModel(dataset) {
  const apiKey =
    process.env.OPENAI_API_KEY ??
    process.env.AZURE_OPENAI_API_KEY ??
    getAzureKeyFromCli();
  if (!apiKey) {
    throw new Error(
      "Missing Azure/OpenAI key. Set OPENAI_API_KEY, AZURE_OPENAI_API_KEY, or AZURE_AI_RESOURCE_GROUP + AZURE_AI_RESOURCE_NAME for az key lookup."
    );
  }

  const baseUrl = requiredEnv("OPENAI_BASE_URL", defaultBaseUrl).replace(/\/$/, "");
  const model = requiredEnv("OPENAI_MODEL", "gpt-5.5");
  const url = `${baseUrl}/chat/completions`;
  const prompt = {
    dataset: {
      source: dataset.source,
      license: dataset.license,
      rows: dataset.rows.map((row) => ({
        id: row.id,
        transcription: row.transcription,
        intent_class: row.intent_class
      }))
    },
    instructions: [
      "You are producing a voice-agent control-plane demo from short banking audio transcripts.",
      "Return only valid JSON.",
      "Do not invent secrets, card numbers, or private account data.",
      "For each row, classify the caller intent in plain English, propose a queue, propose one safe tool call, propose the tool result, and write one concise assistant response.",
      "Mark exactly one call as needs_handoff=true when a human should take over.",
      "Keep assistant responses practical and short."
    ],
    schema: {
      calls: [
        {
          id: "same id as input",
          intent_label: "plain English intent",
          queue: "routing queue",
          needs_handoff: false,
          handoff_reason: "empty unless handoff is needed",
          tool_name: "snake_case tool name",
          tool_arguments: {},
          tool_result: {},
          assistant_response: "short response",
          postcall_actions: ["short action item"]
        }
      ],
      demo_summary: "one sentence"
    }
  };

  const response = await fetchJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Return compact JSON for a realtime voice-agent demo. No markdown."
        },
        {
          role: "user",
          content: JSON.stringify(prompt)
        }
      ],
      max_completion_tokens: 3500
    })
  });

  const content = response.choices?.[0]?.message?.content ?? "";
  return {
    model_request: model,
    model_response: response.model ?? model,
    usage: response.usage,
    generated: parseJsonBlock(content)
  };
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

function event(callId, index, sequence, type, payload) {
  return {
    event_id: `evt_${callId}_${index}_${sequence}`,
    call_id: callId,
    correlation_id: `corr_${callId}`,
    sequence,
    type,
    timestamp: new Date(1760000000000 + index * 60_000 + sequence * 1000).toISOString(),
    payload
  };
}

function buildCallEvents(call, row, index) {
  const callId = `call_${call.id}`;
  const events = [
    event(callId, index, 1, "transcript.final", {
      speaker: "caller",
      text: row.transcription,
      confidence: 0.96,
      is_final: true
    }),
    event(callId, index, 2, "latency.marker", {
      name: "user-stop-to-agent-start",
      value_ms: 318 + index * 31,
      budget_ms: 900
    }),
    event(callId, index, 3, "tool.call", {
      tool_call_id: `tool_${call.id}`,
      tool_name: call.tool_name,
      arguments: call.tool_arguments
    }),
    event(callId, index, 4, "tool.result", {
      tool_call_id: `tool_${call.id}`,
      result: call.tool_result
    }),
    event(callId, index, 5, "transcript.final", {
      speaker: "assistant",
      text: call.assistant_response,
      confidence: 0.98,
      is_final: true
    }),
    event(callId, index, 6, "latency.marker", {
      name: "first-audio",
      value_ms: 420 + index * 27,
      budget_ms: 900
    })
  ];
  return events;
}

async function runControlPlane(dataset, generated) {
  const port = Number(process.env.DEMO_PORT ?? 8123);
  const baseUrl = `http://127.0.0.1:${port}`;
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  const server = spawn("node", ["packages/server/dist/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(port);
    const replays = [];
    for (const [index, row] of dataset.rows.entries()) {
      const call = generated.calls.find((candidate) => candidate.id === row.id) ?? generated.calls[index];
      const callId = `call_${row.id}`;
      await postJson(baseUrl, "/api/calls/start", {
        call_id: callId,
        source: "minds14-azure-foundry-demo",
        caller: {
          phone_e164: `+15550100${index + 1}`,
          locale: "en-US"
        },
        context: {
          tenant: "voice-kit-demo",
          queue: call.queue,
          request_id: `corr_${callId}`
        },
        capabilities: {
          allow_handoff: true,
          allow_tool_calls: true
        }
      });

      const events = buildCallEvents(call, row, index);
      for (const item of events) {
        await postJson(baseUrl, `/api/calls/${callId}/events`, item);
      }

      if (call.needs_handoff) {
        await postJson(baseUrl, `/api/calls/${callId}/handoff`, {
          event_id: `evt_${callId}_handoff_requested`,
          correlation_id: `corr_${callId}`,
          type: "handoff.requested",
          timestamp: new Date(1760000000000 + index * 60_000 + 7000).toISOString(),
          payload: {
            requested_by: "assistant_runtime",
            reason_code: call.handoff_reason || "human_review_requested",
            target_queue: "human-specialist",
            last_transcript_seq: 6,
            context_snapshot_uri: `memory://${callId}/context`
          }
        });
        await postJson(baseUrl, `/api/calls/${callId}/events`, event(callId, index, 7, "handoff.accepted", {
          agent_id: "human_specialist_1",
          accept_time: new Date(1760000000000 + index * 60_000 + 8000).toISOString()
        }));
        await postJson(baseUrl, `/api/calls/${callId}/events`, event(callId, index, 8, "call.closing", {}));
        await postJson(baseUrl, `/api/calls/${callId}/events`, event(callId, index, 9, "call.closed", {}));
      } else {
        await postJson(baseUrl, `/api/calls/${callId}/events`, event(callId, index, 7, "call.closing", {}));
        await postJson(baseUrl, `/api/calls/${callId}/events`, event(callId, index, 8, "call.closed", {}));
      }

      await postJson(baseUrl, `/api/calls/${callId}/postcall`, {
        summary_version: "v1",
        integration_targets: ["crm", "ticketing", "qa"]
      });

      const replay = await fetchJson(`${baseUrl}/api/calls/${callId}/replay`);
      replays.push({
        call_id: callId,
        source_row: row,
        model_plan: call,
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
    total_events: replays.reduce((sum, item) => sum + item.replay.events.length, 0),
    handoffs: replays.filter((item) => item.replay.state === "closed" && item.replay.events.some((eventItem) => eventItem.type === "handoff.requested")).length,
    event_counts: Object.fromEntries([...eventCounts.entries()].sort())
  };
}

function markdownReport(demo) {
  const rows = demo.replays.map((item) => {
    return `| ${item.call_id} | ${item.model_plan.intent_label} | ${item.model_plan.queue} | ${item.model_plan.needs_handoff ? "yes" : "no"} | ${item.replay.events.length} | ${item.replay.post_summary?.payload?.summary_text ?? ""} |`;
  }).join("\n");

  return `# Azure Foundry Demo Output

Dataset: [PolyAI/minds14](https://huggingface.co/datasets/PolyAI/minds14) (${demo.dataset.license})

Model: ${demo.azure.model_response}

Generated at: ${demo.generated_at}

## Summary

- Calls processed: ${demo.summary.calls_processed}
- Events emitted: ${demo.summary.total_events}
- Human handoffs: ${demo.summary.handoffs}

## Calls

| Call | Intent | Queue | Handoff | Events | Post-call summary |
| --- | --- | --- | --- | ---: | --- |
${rows}

## Event Counts

\`\`\`json
${JSON.stringify(demo.summary.event_counts, null, 2)}
\`\`\`
`;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const dataset = await downloadDataset();
  const azure = await callAzureModel(dataset);
  const replays = await runControlPlane(dataset, azure.generated);
  const demo = {
    generated_at: new Date().toISOString(),
    dataset,
    azure,
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

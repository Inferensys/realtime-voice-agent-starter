import WebSocket from "ws";

export interface AzureRealtimeUrlOptions {
  endpoint: string;
  deployment: string;
  apiKey?: string;
  apiKeyInQuery?: boolean;
  apiVersion?: string;
  path?: "ga" | "preview";
}

export interface RealtimeFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface AzureRealtimeAudioTurnOptions {
  endpoint: string;
  deployment: string;
  apiKey: string;
  inputPcm16: Uint8Array;
  inputSampleRate?: number;
  outputSampleRate?: number;
  instructions?: string;
  responseInstructions?: string;
  voice?: string;
  tools?: RealtimeFunctionTool[];
  timeoutMs?: number;
  chunkBytes?: number;
  safetyIdentifier?: string;
}

export interface AzureRealtimeAudioTurnResult {
  deployment: string;
  model?: string;
  durationMs: number;
  inputAudioBytes: number;
  outputAudioBytes: number;
  outputTranscript: string;
  rawEvents: Array<Record<string, unknown>>;
  responseDone?: Record<string, unknown>;
}

export function buildAzureRealtimeWebSocketUrl(options: AzureRealtimeUrlOptions): string {
  const url = new URL(options.endpoint.includes("://") ? options.endpoint : `https://${options.endpoint}`);
  url.protocol = "wss:";
  url.pathname = buildRealtimePath(url.pathname, options.path ?? "ga");
  url.search = "";

  if (options.path === "preview") {
    url.searchParams.set("api-version", options.apiVersion ?? "2025-04-01-preview");
    url.searchParams.set("deployment", options.deployment);
  } else {
    url.searchParams.set("model", options.deployment);
  }

  if (options.apiKeyInQuery && options.apiKey) {
    url.searchParams.set("api-key", options.apiKey);
  }

  return url.toString();
}

export async function runAzureRealtimeAudioTurn(
  options: AzureRealtimeAudioTurnOptions
): Promise<AzureRealtimeAudioTurnResult> {
  const startedAt = Date.now();
  const url = buildAzureRealtimeWebSocketUrl({
    endpoint: options.endpoint,
    deployment: options.deployment
  });
  const rawEvents: Array<Record<string, unknown>> = [];
  const outputAudioChunks: Buffer[] = [];
  let outputTranscript = "";
  let responseDone: Record<string, unknown> | undefined;
  let model: string | undefined;
  let settled = false;

  return await new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "api-key": options.apiKey
    };
    if (options.safetyIdentifier) {
      headers["OpenAI-Safety-Identifier"] = options.safetyIdentifier;
    }

    const ws = new WebSocket(url, { headers });
    const timeout = setTimeout(() => {
      finish(new Error(`Realtime audio turn timed out after ${options.timeoutMs ?? 45_000}ms`));
    }, options.timeoutMs ?? 45_000);

    function finish(error?: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) {
        reject(error);
        return;
      }
      resolve({
        deployment: options.deployment,
        durationMs: Date.now() - startedAt,
        inputAudioBytes: options.inputPcm16.byteLength,
        outputAudioBytes: outputAudioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
        outputTranscript: outputTranscript.trim(),
        rawEvents,
        ...(model !== undefined ? { model } : {}),
        ...(responseDone !== undefined ? { responseDone } : {})
      });
    }

    function send(message: Record<string, unknown>): void {
      ws.send(JSON.stringify(message));
    }

    ws.on("message", (message) => {
      const event = parseServerEvent(message);
      rawEvents.push(event);

      if (event.type === "session.created") {
        model = readNestedString(event, ["session", "model"]);
        send({
          type: "session.update",
          session: {
            type: "realtime",
            instructions: options.instructions ?? defaultInstructions,
            output_modalities: ["audio"],
            tools: options.tools ?? [],
            audio: {
              input: {
                format: {
                  type: "audio/pcm",
                  rate: options.inputSampleRate ?? 24_000
                },
                turn_detection: null
              },
              output: {
                format: {
                  type: "audio/pcm",
                  rate: options.outputSampleRate ?? 24_000
                },
                voice: options.voice ?? "alloy"
              }
            }
          }
        });
        return;
      }

      if (event.type === "session.updated") {
        const chunkBytes = options.chunkBytes ?? 16_000;
        const input = Buffer.from(options.inputPcm16);
        for (let index = 0; index < input.length; index += chunkBytes) {
          send({
            type: "input_audio_buffer.append",
            audio: input.subarray(index, index + chunkBytes).toString("base64")
          });
        }
        send({ type: "input_audio_buffer.commit" });
        send({
          type: "response.create",
          response: {
            instructions: options.responseInstructions ?? defaultResponseInstructions
          }
        });
        return;
      }

      if (event.type === "response.output_audio.delta" && typeof event.delta === "string") {
        outputAudioChunks.push(Buffer.from(event.delta, "base64"));
        return;
      }

      if (event.type === "response.output_audio_transcript.delta" && typeof event.delta === "string") {
        outputTranscript += event.delta;
        return;
      }

      if (event.type === "response.done") {
        responseDone = event;
        finish();
        return;
      }

      if (event.type === "error") {
        const messageText = readNestedString(event, ["error", "message"]) ?? "Realtime API error";
        finish(new Error(messageText));
      }
    });

    ws.on("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function buildRealtimePath(pathname: string, path: "ga" | "preview"): string {
  const cleanPath = pathname.replace(/\/+$/, "");
  if (path === "preview") {
    if (cleanPath.endsWith("/openai/realtime")) {
      return cleanPath;
    }
    if (cleanPath.endsWith("/openai")) {
      return `${cleanPath}/realtime`;
    }
    return "/openai/realtime";
  }

  if (cleanPath.endsWith("/openai/v1/realtime")) {
    return cleanPath;
  }
  if (cleanPath.endsWith("/openai/v1")) {
    return `${cleanPath}/realtime`;
  }
  if (cleanPath.endsWith("/openai")) {
    return `${cleanPath}/v1/realtime`;
  }
  return "/openai/v1/realtime";
}

function parseServerEvent(message: WebSocket.RawData): Record<string, unknown> {
  return JSON.parse(Buffer.isBuffer(message) ? message.toString("utf8") : String(message)) as Record<string, unknown>;
}

function readNestedString(value: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : undefined;
}

const defaultInstructions =
  "You are a practical voice agent. Listen to the caller, answer briefly, and avoid collecting private account numbers or secrets.";

const defaultResponseInstructions =
  "Reply in one short sentence. Include the likely routing queue in square brackets at the end.";

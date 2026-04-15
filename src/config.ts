import { parse } from "@iarna/toml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  session: z.object({
    max_call_seconds: z.number().int().positive(),
    barge_in_enabled: z.boolean(),
    partial_transcript_flush_ms: z.number().int().positive(),
    handoff_timeout_seconds: z.number().int().positive()
  }),
  latency_budget: z.object({
    response_start_p95_ms: z.number().int().positive(),
    tts_first_chunk_p95_ms: z.number().int().positive(),
    tool_call_timeout_ms: z.number().int().positive()
  }),
  postcall: z.object({
    summary_enabled: z.boolean(),
    max_retry_attempts: z.number().int().nonnegative(),
    retry_backoff_seconds: z.number().int().nonnegative()
  })
});

export type RuntimeConfig = z.infer<typeof configSchema>;

export function loadRuntimeConfig(): RuntimeConfig {
  const configPath =
    process.env.AGENT_CONFIG_PATH ?? resolve(process.cwd(), "configs/agent.example.toml");
  const raw = readFileSync(configPath, "utf8");
  const parsed = parse(raw);
  return configSchema.parse(parsed);
}

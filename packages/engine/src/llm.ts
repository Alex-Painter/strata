/**
 * The Anthropic client, configured once. LLM steps (the layer fallback, the
 * summaries and the Guide, later chat) are optional: without a key the engine
 * runs the deterministic analysis only and the report says which steps were
 * skipped.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, type EngineConfig } from "./api.js";

export interface LlmSettings {
  client: Anthropic;
  model: string;
}

export function createLlm(config: EngineConfig): LlmSettings | null {
  const client =
    config.anthropicClient ??
    (config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null);
  if (!client) return null;
  return { client, model: config.model ?? DEFAULT_MODEL };
}

/** A request for JSON that fits a schema. */
export interface JsonQuestion {
  /** Bump when the prompt or schema changes, so cached answers aren't reused. */
  version: number;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}

/** Returns Claude's answer parsed, but not checked against the schema. */
export type AskJson = (question: JsonQuestion, signal?: AbortSignal) => Promise<unknown>;

export class ClaudeError extends Error {}

/**
 * Asks Claude, with answers cached under `cacheDir` by a hash of the exact
 * request: the same input gets the same answer on every run, and costs nothing
 * the second time. Refusals, cut-off answers and bad JSON throw and aren't
 * cached.
 */
export function cachedAsk(llm: LlmSettings, cacheDir: string): AskJson {
  return async (question, signal) => {
    const body = {
      model: llm.model,
      max_tokens: question.maxTokens,
      system: question.system,
      messages: [{ role: "user" as const, content: question.prompt }],
      output_config: {
        effort: question.effort,
        format: { type: "json_schema" as const, schema: question.schema },
      },
    };
    const key = createHash("sha256")
      .update(JSON.stringify({ version: question.version, body }))
      .digest("hex");
    const path = join(cacheDir, `${key}.json`);
    const cached = await readCached(path);
    if (cached !== null) return cached;

    const message = await llm.client.messages.create(body, signal ? { signal } : {});
    if (message.stop_reason === "refusal") throw new ClaudeError("Claude declined to answer.");
    if (message.stop_reason === "max_tokens") {
      throw new ClaudeError("Claude's answer was cut off.");
    }
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    let answer: unknown;
    try {
      answer = JSON.parse(text.join(""));
    } catch {
      throw new ClaudeError("Claude's answer wasn't valid JSON.");
    }
    await mkdir(cacheDir, { recursive: true });
    // Written whole, then renamed, so a crash never leaves half an answer.
    await writeFile(`${path}.tmp`, JSON.stringify(answer));
    await rename(`${path}.tmp`, path);
    return answer;
  };
}

/** Null when there's no answer yet, or the file can't be read; either way, Claude is asked. */
async function readCached(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

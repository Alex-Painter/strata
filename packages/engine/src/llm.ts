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
  const { anthropicApiKey: apiKey, anthropicBaseUrl: baseURL } = config;
  const client =
    config.anthropicClient ??
    (apiKey ? new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) }) : null);
  if (!client) return null;
  return { client, model: config.model ?? DEFAULT_MODEL };
}

/**
 * Strata writes all user-facing text in ASD-STE100 Simplified Technical
 * English (see AGENTS.md). Every prompt whose answer a person reads ends with
 * this, so Claude's text follows the same rules as the rest of the UI.
 */
export const STE_RULE = [
  "Write all text that a person reads in ASD-STE100 Simplified Technical English:",
  "- Use short sentences: 20 words at most for an instruction, 25 words at most for a description.",
  "- Give one topic in each sentence, and one instruction in each sentence.",
  "- Use the active voice and simple tenses (present, simple past, future).",
  "- Use the imperative for instructions.",
  "- Use the approved ASD-STE100 words, with their approved meanings. Use one word for one meaning, and one meaning for one word.",
  '- Do not use phrasal verbs (for example, use "start", not "set up"), or -ing forms that are not technical names.',
  '- Use "a", "an" and "the" where English permits them. Do not use contractions.',
  "- Technical names (paths, symbols, product names, code terms) are permitted as they are.",
].join("\n");

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
    if (message.stop_reason === "refusal") throw new ClaudeError("Claude did not answer.");
    if (message.stop_reason === "max_tokens") {
      throw new ClaudeError("Claude's answer is not complete.");
    }
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    let answer: unknown;
    try {
      answer = JSON.parse(text.join(""));
    } catch {
      throw new ClaudeError("Claude's answer is not valid JSON.");
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

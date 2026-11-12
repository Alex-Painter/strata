/**
 * The Anthropic client, configured once. LLM steps (the layer fallback, the
 * summaries and the Guide, later chat) are optional: without a key the engine
 * runs the deterministic analysis only and the report says which steps were
 * skipped.
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODELS, type EngineConfig } from "./api.js";

/** What Strata asks Claude for. Each task is logged apart, so its cost shows. */
export type LlmTask = "layers" | "pr-summary" | "whole-summary" | "chat";

export const LLM_TASKS: readonly LlmTask[] = ["layers", "pr-summary", "whole-summary", "chat"];

export interface LlmSettings {
  client: Anthropic;
  models: Record<LlmTask, string>;
  /** Called once for each request to Claude, and for each answer read from the cache. */
  recordUsage: (entry: UsageEntry) => void;
}

export function createLlm(config: EngineConfig): LlmSettings | null {
  const { anthropicApiKey: apiKey, anthropicBaseUrl: baseURL } = config;
  const client =
    config.anthropicClient ??
    (apiKey ? new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) }) : null);
  if (!client) return null;
  return {
    client,
    models: modelsOf(config),
    recordUsage: config.recordUsage ?? usageFile(config.dataDir, config.log),
  };
}

/** For each task: `models`, then `model`, then DEFAULT_MODELS. */
export function modelsOf(config: Pick<EngineConfig, "model" | "models">): Record<LlmTask, string> {
  return Object.fromEntries(
    LLM_TASKS.map((task) => [task, config.models?.[task] ?? config.model ?? DEFAULT_MODELS[task]]),
  ) as Record<LlmTask, string>;
}

/** One request to Claude, or one answer read from Strata's cache, in `<dataDir>/llm-usage.jsonl`. */
export interface UsageEntry {
  at: string;
  task: LlmTask;
  model: string;
  /** True when Strata used a cached answer and Claude was not asked. */
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** From PRICES; null for a model that is not in it. */
  costUsd: number | null;
  /** `owner/name`, when the request was for one repo. Lines written before 2026-11-12 have none. */
  repo?: string;
  /** The server's Change id, when the request was for one Change. */
  changeId?: string;
}

/** What one run or chat was for, added to each usage line it writes. */
export interface UsageTag {
  repo?: string;
  changeId?: string;
}

/** The same settings, with every usage line tagged. */
export function tagUsage(llm: LlmSettings, tag: UsageTag): LlmSettings {
  return { ...llm, recordUsage: (entry) => llm.recordUsage({ ...entry, ...tag }) };
}

export const USAGE_FILE = "llm-usage.jsonl";

/** US dollars per million tokens: input, output. Cache reads cost 0.1 of input, 5-minute writes 1.25. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

export function usageEntry(
  task: LlmTask,
  model: string,
  usage: Partial<Anthropic.Usage> | null | undefined,
  cached = false,
): UsageEntry {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0;
  const price = PRICES[model];
  const costUsd = cached
    ? 0
    : price
      ? (price[0] * (inputTokens + 0.1 * cacheReadTokens + 1.25 * cacheWriteTokens) +
          price[1] * outputTokens) /
        1_000_000
      : null;
  return {
    at: new Date().toISOString(),
    task,
    model,
    cached,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd,
  };
}

/** Appends each entry to the usage file. A failed write is logged; it never fails the run. */
function usageFile(dataDir: string, log?: (message: string) => void): (entry: UsageEntry) => void {
  const path = join(dataDir, USAGE_FILE);
  let chain: Promise<void> = Promise.resolve();
  return (entry) => {
    chain = chain
      .then(async () => {
        await mkdir(dataDir, { recursive: true });
        await appendFile(path, `${JSON.stringify(entry)}\n`);
      })
      .catch((error: unknown) => log?.(`Strata cannot write the token usage: ${String(error)}`));
  };
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
  task: LlmTask;
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
      model: llm.models[question.task],
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
    if (cached !== null) {
      llm.recordUsage(usageEntry(question.task, body.model, null, true));
      return cached;
    }

    const message = await llm.client.messages.create(body, signal ? { signal } : {});
    // Claude bills a request whatever its answer, so it is logged before the checks.
    llm.recordUsage(usageEntry(question.task, message.model ?? body.model, message.usage));
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

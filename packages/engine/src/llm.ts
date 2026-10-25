/**
 * The Anthropic client, configured once. LLM steps (ledger extraction, chat)
 * are optional: without a key the engine runs the deterministic analysis only
 * and the report says which steps were skipped.
 */
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, type EngineConfig } from "./api.js";

export interface LlmSettings {
  client: Anthropic;
  model: string;
}

export function createLlm(config: EngineConfig): LlmSettings | null {
  if (!config.anthropicApiKey) return null;
  return {
    client: new Anthropic({ apiKey: config.anthropicApiKey }),
    model: config.model ?? DEFAULT_MODEL,
  };
}

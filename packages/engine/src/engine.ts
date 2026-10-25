import type { CreateEngine } from "./api.js";
import { NotImplementedError } from "./errors.js";
import { createLlm } from "./llm.js";

/**
 * Wires the engine together. In the scaffold every operation is a stub, so the
 * CLI and server can be built and tested against the real contract while
 * milestone 1 fills in: git and GitHub resolution, the analysis pipeline over
 * @strata/core, anchor resolution, and chat.
 */
export const createEngine: CreateEngine = (config) => {
  const llm = createLlm(config);
  config.log?.(
    llm ? `LLM steps enabled (${llm.model})` : "LLM steps disabled: no Anthropic API key",
  );

  return {
    async resolveChange() {
      throw new NotImplementedError("Resolving a PR, stack or commit range");
    },
    async analyzeChange() {
      throw new NotImplementedError("Change analysis");
    },
    async readFile() {
      throw new NotImplementedError("Reading files at a revision");
    },
    async resolveAnchors() {
      throw new NotImplementedError("Anchor resolution");
    },
    // biome-ignore lint/correctness/useYield: a stub that always throws.
    async *chat() {
      throw new NotImplementedError("Chat");
    },
  };
};

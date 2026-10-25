import { type ChangeInput, linkedGroups, type PrIndex, type RepoRef } from "@strata/core";
import type { CreateEngine, EngineConfig } from "./api.js";
import { NotImplementedError } from "./errors.js";
import { RepoCache } from "./git/cache.js";
import { createGitHubPort, GitHubError, type GitHubPort } from "./github/port.js";
import { loadPrIndex, splitRepo } from "./github/pr-index.js";
import { createLlm } from "./llm.js";
import { serialize } from "./lock.js";
import {
  resolveStackChange,
  type StackInput,
  StackInputError,
  stackReport,
} from "./stack/change.js";
import { discoverStacks } from "./stack/discover.js";
import { ENGINE_VERSION } from "./version.js";

/**
 * Wires the engine together. Stack discovery works; the other operations are
 * still stubs, so the CLI and server can be built and tested against the real
 * contract while milestone 1 fills in: resolving a Change, the analysis
 * pipeline over @strata/core, anchor resolution, and chat.
 */
export const createEngine: CreateEngine = (config) => {
  const llm = createLlm(config);
  config.log?.(
    llm ? `LLM steps enabled (${llm.model})` : "LLM steps disabled: no Anthropic API key",
  );

  return {
    discoverStacks(repo, signal) {
      return serialize(lockKey(config, repo), async () => {
        const index = await loadIndex(config, repo);
        signal?.throwIfAborted();
        const cache = await openCache(config, repo);
        await cache.fetch({ pulls: linkedGroups(index).flat() });
        signal?.throwIfAborted();
        return discoverStacks(index, cache.gitDir);
      });
    },
    async resolveChange(input) {
      const stackInput = asStackInput(input);
      const repo = `${stackInput.repo.owner}/${stackInput.repo.name}`;
      return serialize(lockKey(config, repo), async () => {
        const index = await loadIndex(config, repo);
        return resolveStackChange(stackInput, index, await openCache(config, repo));
      });
    },
    async analyzeChange(input, options = {}) {
      const startedAt = new Date();
      options.onProgress?.("Finding the stack");
      const resolved = await this.resolveChange(input, options.signal);
      if (!resolved.stack) throw new NotImplementedError("Analysing a commit range");
      return stackReport({ ...resolved, stack: resolved.stack }, options, {
        engineVersion: ENGINE_VERSION,
        startedAt,
      });
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

function githubPort(config: EngineConfig): GitHubPort {
  if (config.githubPort) return config.githubPort;
  if (!config.githubToken)
    throw new GitHubError("Finding stacks needs a GitHub token (GITHUB_TOKEN).");
  return createGitHubPort({ token: config.githubToken });
}

function openCache(config: EngineConfig, repo: string): Promise<RepoCache> {
  const checkout = config.checkouts?.[repo];
  const remoteUrl = config.gitRemote?.(repo);
  return RepoCache.open(repo, {
    dataDir: config.dataDir,
    ...(checkout ? { checkout } : {}),
    ...(config.githubToken ? { token: config.githubToken } : {}),
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(config.log ? { log: config.log } : {}),
  });
}

/** Engines with the same data folder share its caches, so they share its locks. */
function lockKey(config: EngineConfig, repo: string): string {
  return `${config.dataDir}\0${repo}`;
}

function loadIndex(config: EngineConfig, repo: string): Promise<PrIndex> {
  splitRepo(repo);
  return loadPrIndex(repo, {
    port: githubPort(config),
    dataDir: config.dataDir,
    ...(config.now ? { now: config.now } : {}),
    ...(config.log ? { log: config.log } : {}),
  });
}

type GitHubStackInput = StackInput & { repo: Extract<RepoRef, { kind: "github" }> };

function asStackInput(input: ChangeInput): GitHubStackInput {
  if (input.kind === "range") throw new NotImplementedError("Resolving a commit range");
  if (input.repo.kind !== "github") {
    throw new StackInputError("Stacks come from GitHub; give the repo as owner/repo.");
  }
  return input as GitHubStackInput;
}

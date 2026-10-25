import { linkedGroups } from "@strata/core";
import type { CreateEngine, EngineConfig } from "./api.js";
import { NotImplementedError } from "./errors.js";
import { RepoCache } from "./git/cache.js";
import { createGitHubPort, GitHubError, type GitHubPort } from "./github/port.js";
import { loadPrIndex, splitRepo } from "./github/pr-index.js";
import { createLlm } from "./llm.js";
import { discoverStacks } from "./stack/discover.js";

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
    async discoverStacks(repo, signal) {
      splitRepo(repo);
      const index = await loadPrIndex(repo, {
        port: githubPort(config),
        dataDir: config.dataDir,
        ...(config.now ? { now: config.now } : {}),
        ...(config.log ? { log: config.log } : {}),
      });
      signal?.throwIfAborted();
      const cache = await openCache(config, repo);
      await cache.fetch({ pulls: linkedGroups(index).flat() });
      signal?.throwIfAborted();
      return discoverStacks(index, cache.gitDir);
    },
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

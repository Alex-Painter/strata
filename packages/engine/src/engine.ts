import { join } from "node:path";
import { type ChangeInput, linkedGroups, type PrIndex, type RepoRef } from "@strata/core";
import type { CreateEngine, EngineConfig } from "./api.js";
import { NotImplementedError } from "./errors.js";
import { RepoCache } from "./git/cache.js";
import { createGitHubPort, GitHubError, type GitHubPort } from "./github/port.js";
import { loadPrIndex, splitRepo } from "./github/pr-index.js";
import { createLlmLayerJudge, type LayerJudge } from "./layers/judge.js";
import { type AskJson, cachedAsk, createLlm, type LlmSettings } from "./llm.js";
import { serialize } from "./lock.js";
import { rangeReport, resolveRangeChange } from "./range.js";
import { loadRepoSettings, type RepoSettings } from "./settings.js";
import {
  resolveStackChange,
  type StackInput,
  StackInputError,
  stackReport,
} from "./stack/change.js";
import { discoverStacks } from "./stack/discover.js";
import { ENGINE_VERSION } from "./version.js";

/**
 * Wires the engine together. Stacks and ranges on GitHub repos work; ranges in
 * a local checkout, reading files, anchor resolution and chat are still stubs,
 * so the CLI and server can be built and tested against the real contract.
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
      const gh = githubInput(input);
      return serialize(lockKey(config, repoName(gh)), async () =>
        gh.kind === "range"
          ? resolveRangeChange(gh, await openCache(config, repoName(gh)))
          : resolveStackInput(config, gh),
      );
    },
    async analyzeChange(input, options = {}) {
      const startedAt = new Date();
      const gh = githubInput(input);
      const repo = repoName(gh);
      // The diffs write commits into the cache and read its branches, so they
      // run under the same lock as the fetch.
      return serialize(lockKey(config, repo), async () => {
        const settings = await loadRepoSettings(config.dataDir, repo);
        const ask = settings.sendCodeToAnthropic && llm ? summaryAsk(config, llm) : null;
        const meta = {
          engineVersion: ENGINE_VERSION,
          startedAt,
          settings,
          judge: layerJudge(config, llm, settings),
          ask,
          ...(llm ? { model: llm.model } : {}),
        };
        if (gh.kind === "range") {
          options.onProgress?.("Finding the range");
          const resolved = await resolveRangeChange(gh, await openCache(config, repo));
          options.signal?.throwIfAborted();
          options.onProgress?.("Building the diff");
          return rangeReport(resolved, options, meta);
        }
        options.onProgress?.("Finding the stack");
        const resolved = await resolveStackInput(config, gh);
        options.signal?.throwIfAborted();
        options.onProgress?.("Building the diffs");
        return stackReport(resolved, options, meta);
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

/** Claude sorts unmatched files only for repos whose settings allow their code to be sent. */
function layerJudge(
  config: EngineConfig,
  llm: LlmSettings | null,
  settings: RepoSettings,
): LayerJudge | null {
  if (!settings.sendCodeToAnthropic) return null;
  if (config.layerJudge) return config.layerJudge;
  return llm ? createLlmLayerJudge(llm, join(config.dataDir, "llm-cache", "layers")) : null;
}

/** Summaries are cached apart from layer answers, so either can be cleared alone. */
function summaryAsk(config: EngineConfig, llm: LlmSettings): AskJson {
  return cachedAsk(llm, join(config.dataDir, "llm-cache", "summaries"));
}

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

type GitHubInput = ChangeInput & { repo: Extract<RepoRef, { kind: "github" }> };

function repoName(input: GitHubInput): string {
  return `${input.repo.owner}/${input.repo.name}`;
}

/** Call with the repo's lock held. */
async function resolveStackInput(config: EngineConfig, input: StackInput & GitHubInput) {
  const repo = repoName(input);
  const index = await loadIndex(config, repo);
  return resolveStackChange(input, index, await openCache(config, repo));
}

function githubInput(input: ChangeInput): GitHubInput {
  if (input.repo.kind === "github") return input as GitHubInput;
  if (input.kind === "range") throw new NotImplementedError("Ranges in a local checkout");
  throw new StackInputError("Stacks come from GitHub; give the repo as owner/repo.");
}

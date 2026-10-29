import { join } from "node:path";
import type { ChangeInput, ChangeReport, PrIndex, RepoRef } from "@strata/core";
import type { CreateEngine, EngineConfig } from "./api.js";
import { runChat } from "./chat/chat.js";
import { type ReadFile, resolveAnchors } from "./chat/context.js";
import { NotImplementedError } from "./errors.js";
import { RepoCache } from "./git/cache.js";
import { git } from "./git/run.js";
import { findAssigned } from "./github/assigned.js";
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
import { discoverStacks, groupsToFind } from "./stack/discover.js";
import { ENGINE_VERSION } from "./version.js";

/**
 * Wires the engine together. Stacks and ranges on GitHub repos, reading files,
 * anchors and chat work; ranges in a local checkout are still a stub.
 */
export const createEngine: CreateEngine = (config) => {
  const llm = createLlm(config);
  config.log?.(
    llm ? `LLM steps enabled (${llm.model})` : "LLM steps disabled: there is no Anthropic API key",
  );

  return {
    discoverStacks(repo, options = {}) {
      const { signal, onProgress, open = false } = options;
      return serialize(lockKey(config, repo), async () => {
        const index = await loadIndex(config, repo, onProgress);
        signal?.throwIfAborted();
        const cache = await openCache(config, repo, onProgress);
        await cache.fetch({ pulls: groupsToFind(index, open).flat() });
        signal?.throwIfAborted();
        return discoverStacks(index, cache.gitDir, { open, ...(onProgress ? { onProgress } : {}) });
      });
    },
    // Two small searches; nothing in the repo's caches, so no lock.
    findAssigned(repo) {
      return findAssigned(githubPort(config), repo);
    },
    async resolveChange(input, options = {}) {
      const gh = githubInput(input);
      return serialize(lockKey(config, repoName(gh)), async () =>
        gh.kind === "range"
          ? resolveRangeChange(gh, await openCache(config, repoName(gh), options.onProgress))
          : resolveStackInput(config, gh, options.onProgress),
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
          options.onProgress?.("Strata finds the range");
          const resolved = await resolveRangeChange(
            gh,
            await openCache(config, repo, options.onProgress),
          );
          options.signal?.throwIfAborted();
          options.onProgress?.("Strata makes the diff");
          return rangeReport(resolved, options, meta);
        }
        options.onProgress?.("Strata finds the stack");
        const resolved = await resolveStackInput(config, gh, options.onProgress);
        options.signal?.throwIfAborted();
        options.onProgress?.("Strata makes the diffs");
        return stackReport(resolved, options, meta);
      });
    },
    async readFile(repo, revision, path) {
      if (repo.kind !== "github")
        throw new NotImplementedError("Reading files in a local checkout");
      const cache = await openCache(config, `${repo.owner}/${repo.name}`);
      return showFile(cache.gitDir, revision, path);
    },
    async resolveAnchors(report, anchors) {
      return resolveAnchors(report, anchors, await reportFiles(config, report));
    },
    async *chat(request) {
      const { report } = request;
      const repo = reportRepo(report);
      const settings = await loadRepoSettings(config.dataDir, repo);
      if (!llm) throw new ChatUnavailableError("Strata does not have an Anthropic API key.");
      if (!settings.sendCodeToAnthropic) {
        throw new ChatUnavailableError(
          `The settings of ${repo} do not let Strata send its code to Claude.`,
        );
      }
      const readFile = await reportFiles(config, report);
      const head = report.change.revisions?.head;
      const gitDir = (await openCache(config, repo)).gitDir;
      const history = await Promise.all(
        request.history.map(async (message) => ({
          message,
          anchors: await resolveAnchors(report, message.anchors, readFile),
        })),
      );
      yield* runChat({
        client: llm.client,
        model: llm.model,
        report,
        history,
        text: request.text,
        anchors: await resolveAnchors(report, request.anchors, readFile),
        tools: {
          readFile,
          search: async (text) => (head ? grep(gitDir, head, text) : ""),
        },
        ...(request.signal ? { signal: request.signal } : {}),
      });
    },
  };
};

/** Thrown by chat when Claude cannot be asked about this repo. */
export class ChatUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatUnavailableError";
  }
}

function reportRepo(report: ChangeReport): string {
  const repo = report.change.repo;
  if (repo.kind !== "github") throw new NotImplementedError("Chat about a local checkout");
  return `${repo.owner}/${repo.name}`;
}

/** Reads files at the report's base or head, from the repo's cache. */
async function reportFiles(config: EngineConfig, report: ChangeReport): Promise<ReadFile> {
  const revisions = report.change.revisions;
  if (!revisions) return async () => null;
  const cache = await openCache(config, reportRepo(report));
  return (path, side) => showFile(cache.gitDir, revisions[side], path);
}

/** Null when the path is not a file at the revision. */
async function showFile(gitDir: string, revision: string, path: string): Promise<string | null> {
  const clean = path.replace(/^\/+/, "");
  if (clean === "" || clean.split("/").includes("..")) return null;
  const result = await git(gitDir, ["cat-file", "blob", `${revision}:${clean}`]);
  return result.code === 0 ? result.stdout : null;
}

/** Lines with a fixed string at a revision, as path:line:text, 60 at most. */
async function grep(gitDir: string, revision: string, text: string): Promise<string> {
  const result = await git(gitDir, [
    "grep",
    "-n",
    "-I",
    "-F",
    "--max-count=5",
    "-e",
    text,
    revision,
    "--",
  ]);
  // 1 means no match; anything else past 0 is an error, reported as no match.
  if (result.code !== 0) return "";
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, 60)
    .map((line) => line.slice(revision.length + 1))
    .join("\n");
}

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
    throw new GitHubError("Strata must have a GitHub token (GITHUB_TOKEN) to find stacks.");
  return createGitHubPort({ token: config.githubToken });
}

/** The cache says when it clones or fetches, in the log and as progress to a caller following it. */
function openCache(
  config: EngineConfig,
  repo: string,
  onProgress?: (step: string) => void,
): Promise<RepoCache> {
  const checkout = config.checkouts?.[repo];
  const remoteUrl = config.gitRemote?.(repo);
  const log =
    onProgress && config.log && config.logProgress
      ? (message: string) => {
          config.log?.(message);
          onProgress(message);
        }
      : (onProgress ?? config.log);
  return RepoCache.open(repo, {
    dataDir: config.dataDir,
    ...(checkout ? { checkout } : {}),
    ...(config.githubToken ? { token: config.githubToken } : {}),
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(log ? { log } : {}),
  });
}

/** Engines with the same data folder share its caches, so they share its locks. */
function lockKey(config: EngineConfig, repo: string): string {
  return `${config.dataDir}\0${repo}`;
}

function loadIndex(
  config: EngineConfig,
  repo: string,
  onProgress?: (step: string) => void,
): Promise<PrIndex> {
  splitRepo(repo);
  return loadPrIndex(repo, {
    port: githubPort(config),
    dataDir: config.dataDir,
    ...(config.now ? { now: config.now } : {}),
    ...(config.log ? { log: config.log } : {}),
    ...(onProgress ? { onProgress } : {}),
  });
}

type GitHubInput = ChangeInput & { repo: Extract<RepoRef, { kind: "github" }> };

function repoName(input: GitHubInput): string {
  return `${input.repo.owner}/${input.repo.name}`;
}

/** Call with the repo's lock held. */
async function resolveStackInput(
  config: EngineConfig,
  input: StackInput & GitHubInput,
  onProgress?: (step: string) => void,
) {
  const repo = repoName(input);
  const index = await loadIndex(config, repo, onProgress);
  return resolveStackChange(input, index, await openCache(config, repo, onProgress));
}

function githubInput(input: ChangeInput): GitHubInput {
  if (input.repo.kind === "github") return input as GitHubInput;
  if (input.kind === "range") throw new NotImplementedError("Ranges in a local checkout");
  throw new StackInputError("Stacks come from GitHub. Give the repo as owner/repo.");
}

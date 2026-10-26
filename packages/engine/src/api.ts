/**
 * The engine's public contract. `apps/cli` and `apps/server` depend only on
 * what this file declares, so treat changes here as API changes: update both
 * callers in the same commit.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type {
  Anchor,
  ChangeHint,
  ChangeInput,
  ChangeReport,
  ChangeRevisions,
  ChatMessage,
  ContextSource,
  RepoRef,
  Stack,
} from "@strata/core";
import type { GitHubPort } from "./github/port.js";
import type { LayerJudge } from "./layers/judge.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

export interface EngineConfig {
  /** Root for the git clone cache and the LLM response cache. */
  dataDir: string;
  /** Token for the GitHub API and git over HTTPS. Not needed for local repos. */
  githubToken?: string;
  /**
   * Local checkouts by `owner/name`. Strata's own clone borrows their objects
   * once and never writes to them. Paths stay here, out of the model.
   */
  checkouts?: Record<string, string>;
  /** Replaces the GitHub API client; tests pass a fake. */
  githubPort?: GitHubPort;
  /** Where to clone `owner/name` from. Defaults to GitHub over HTTPS; tests use local repos. */
  gitRemote?: (repo: string) => string;
  /** The clock for the PR index window. Tests fix it. */
  now?: () => Date;
  /** Without a key, LLM steps are skipped and the report says so. */
  anthropicApiKey?: string;
  /** Replaces the Anthropic client made from the key; tests pass a fake. */
  anthropicClient?: Anthropic;
  /**
   * Replaces the Anthropic-backed judge of layers for files no rule matched;
   * tests pass a fake. Either way it's only asked for repos whose settings
   * turn on sendCodeToAnthropic.
   */
  layerJudge?: LayerJudge;
  /** Defaults to DEFAULT_MODEL. */
  model?: string;
  log?: (message: string) => void;
}

export interface AnalyzeOptions {
  /** Intent sources linked to the Change (spec, ticket, design, notes). */
  sources?: ContextSource[];
  /** Called with a short, human-readable step name as the run progresses. */
  onProgress?: (step: string) => void;
  signal?: AbortSignal;
}

/** Where a ChangeInput points, once PR numbers and refs are resolved to SHAs. */
export interface ResolvedChange {
  repo: RepoRef;
  /** A local git directory holding both revisions. */
  gitDir: string;
  /** Null when git couldn't tell where a stack left its trunk. */
  revisions: ChangeRevisions | null;
  title: string;
  hints: ChangeHint[];
  /** One per PR; shown as context, never used to build the ledger. */
  prDescriptions: ContextSource[];
  /** For stack inputs: the whole stack, with `selectedPath` as this Change. */
  stack: Stack | null;
}

/** An anchor turned into text for the chat prompt. */
export interface ResolvedAnchor {
  anchor: Anchor;
  /** e.g. "src/models/user.py:12-18 (head)" or "Spec: Billing admins". */
  label: string;
  /** The highlighted text with a few lines of surrounding context. */
  text: string;
  /** True when the quote can no longer be found in the source. */
  orphaned: boolean;
}

export interface ChatRequest {
  report: ChangeReport;
  /** Earlier messages in the thread, oldest first. */
  history: ChatMessage[];
  text: string;
  anchors: Anchor[];
  signal?: AbortSignal;
}

export type ChatChunk = { type: "text"; text: string } | { type: "status"; text: string };

export interface Engine {
  /** Every stack among the PRs updated in the last 90 days, bottom PR first. */
  discoverStacks(repo: string, signal?: AbortSignal): Promise<Stack[]>;
  resolveChange(input: ChangeInput, signal?: AbortSignal): Promise<ResolvedChange>;
  analyzeChange(input: ChangeInput, options?: AnalyzeOptions): Promise<ChangeReport>;
  /** Null when the file does not exist at that revision. */
  readFile(repo: RepoRef, revision: string, path: string): Promise<string | null>;
  resolveAnchors(report: ChangeReport, anchors: Anchor[]): Promise<ResolvedAnchor[]>;
  /** Streams the assistant's reply. Throws if no Anthropic key is configured. */
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export type CreateEngine = (config: EngineConfig) => Engine;

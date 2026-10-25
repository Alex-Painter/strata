/**
 * The engine's public contract. `apps/cli` and `apps/server` depend only on
 * what this file declares, so treat changes here as API changes: update both
 * callers in the same commit.
 */
import type {
  Anchor,
  ChangeHint,
  ChangeInput,
  ChangeReport,
  ChangeRevisions,
  ChatMessage,
  ContextSource,
  LayerRule,
  RepoRef,
} from "@strata/core";

export const DEFAULT_MODEL = "claude-opus-5-5";

export interface EngineConfig {
  /** Root for the git clone cache and the LLM response cache. */
  dataDir: string;
  /** Token for the GitHub API and git over HTTPS. Not needed for local repos. */
  githubToken?: string;
  /** Without a key, LLM steps are skipped and the report says so. */
  anthropicApiKey?: string;
  /** Defaults to DEFAULT_MODEL. */
  model?: string;
  /** Repo-specific layer rules, checked before the defaults. */
  layerRules?: LayerRule[];
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
  revisions: ChangeRevisions;
  title: string;
  hints: ChangeHint[];
  /** One per PR; shown as context, never used to build the ledger. */
  prDescriptions: ContextSource[];
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
  resolveChange(input: ChangeInput, signal?: AbortSignal): Promise<ResolvedChange>;
  analyzeChange(input: ChangeInput, options?: AnalyzeOptions): Promise<ChangeReport>;
  /** Null when the file does not exist at that revision. */
  readFile(repo: RepoRef, revision: string, path: string): Promise<string | null>;
  resolveAnchors(report: ChangeReport, anchors: Anchor[]): Promise<ResolvedAnchor[]>;
  /** Streams the assistant's reply. Throws if no Anthropic key is configured. */
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
}

export type CreateEngine = (config: EngineConfig) => Engine;

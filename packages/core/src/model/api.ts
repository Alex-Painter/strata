/**
 * HTTP contract between `apps/server` and `apps/web`. Both import these types,
 * so a change here is a compile error on both sides rather than a runtime 404.
 */
import type { AssignedReason } from "./assigned.js";
import type { Evidence } from "./change.js";
import type { ContextKind, ContextSource } from "./context.js";
import type { ChangeReport } from "./report.js";
import type { LinkState, PrState, StackIssue, StackPr } from "./stack.js";

export interface MeResponse {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface NewContextSource {
  kind: ContextKind;
  title: string;
  content: string;
  url?: string;
}

export interface CreateChangeRequest {
  /** Anything `parseChangeInput` accepts, except local ranges. */
  input: string;
  /** For a stack that forks: the tip PR whose path to review. */
  leaf?: number;
  sources?: NewContextSource[];
}

/** One PR in a stack, as the stack list shows it. */
export interface StackPrSummary {
  number: number;
  title: string;
  url: string;
  author: string | null;
  state: PrState;
  draft: boolean;
  /** When the PR was opened. */
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  baseRef: string;
  headRef: string;
  /** For merged PRs: the commit it landed as. */
  mergeCommitOid: string | null;
  /** Null for the bottom PR. */
  parent: number | null;
  /** How it sits on its parent; null for the bottom PR. */
  link: LinkState | null;
  /** The commits and PRs the link rests on. */
  linkEvidence: Evidence[];
  review: StackPr["review"];
  checks: StackPr["checks"];
}

/**
 * What a list of Changes, and a Change page before its first report, shows
 * for each PR on a path. Changes saved before Strata kept the title, URL and
 * branches lack them until Strata reads the path again.
 */
export type PathPr = Pick<
  StackPrSummary,
  "number" | "author" | "createdAt" | "state" | "draft" | "review" | "checks"
> &
  Partial<Pick<StackPrSummary, "title" | "url" | "baseRef" | "headRef">>;

export interface StackSummary {
  id: string;
  repo: string;
  trunk: string;
  /** Where the stack left the trunk; null when git couldn't tell. */
  base: string | null;
  root: number;
  /** Depth first from the bottom, siblings by PR number. */
  prs: StackPrSummary[];
  /** Every bottom-to-tip path; each one is a Change. */
  paths: number[][];
  /** The path a Change gets when no tip is chosen. */
  defaultPath: number[];
  issues: StackIssue[];
  /** The newest updatedAt among its PRs. */
  updatedAt: string;
}

export interface StacksResponse {
  repo: string;
  /** Newest activity first. */
  stacks: StackSummary[];
  /** When this list was read; it may be a few minutes old. */
  readAt: string;
  /** True while a newer read runs behind this list. */
  refreshing: boolean;
}

/**
 * A 202 from a request that's still working, such as the first read of a big
 * repo: send the same request again for newer progress or the result.
 */
export interface PendingResponse {
  pending: true;
  /** The latest step, such as "Reading PRs from GitHub: 350 so far". */
  progress: string | null;
}

export type RunStatus = "queued" | "running" | "done" | "failed";

export interface RunInfo {
  id: string;
  status: RunStatus;
  /** The step in progress, e.g. "Fetching PR head". */
  progress: string | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** One of your PRs on a Change's path, and why GitHub lists it for you. */
export interface YourPr {
  number: number;
  reasons: AssignedReason[];
  /** False once GitHub stops listing it: merged, closed, or no longer yours. */
  active: boolean;
  /** When GitHub last listed it. */
  seenAt: string;
}

export interface ChangeSummary {
  id: string;
  title: string;
  repo: string;
  input: string;
  status: RunStatus | null;
  /** "assigned" when Strata found it from your GitHub assignments, "added" when you typed it in. */
  origin: "added" | "assigned";
  /** Your PRs on its path, active first, then by number. */
  yours: YourPr[];
  /**
   * True while one of its PRs is assigned to you or asks for your review.
   * A PR you've only reviewed doesn't wait on you.
   */
  waiting: boolean;
  /** Its path's bottom and tip PRs, to match it to a stack. */
  rootPr: number;
  tipPr: number;
  /**
   * Its PRs, bottom first, as GitHub showed them when Strata last read the
   * path. Empty for a Change that Strata has not read since it kept them.
   */
  prs: PathPr[];
  createdAt: string;
  updatedAt: string;
}

export interface ChangeDetail {
  change: ChangeSummary;
  run: RunInfo | null;
  /** The latest successful report, which may be older than `run`. */
  report: ChangeReport | null;
  sources: ContextSource[];
}

export interface FileContentResponse {
  path: string;
  side: "base" | "head";
  revision: string;
  lines: string[];
}

/** A repo's settings that the web app can change. */
export interface RepoSettingsResponse {
  repo: string;
  /** Claude reads the repo's code to write summaries and to place unclear files. */
  sendCodeToAnthropic: boolean;
  /** False when the server has no Anthropic API key, so the setting has no effect. */
  claudeAvailable: boolean;
}

/** Where the search for your assigned PRs stands. */
export interface AssignedStatus {
  /** The repos Strata searches. */
  repos: string[];
  running: boolean;
  /** The step in progress, e.g. "Finding the stack for GlyphicAI/maverick-backend#9338". */
  progress: string | null;
  /** When the last search finished, or null before the first. */
  lastFinishedAt: string | null;
  /** Problems from the last search, one per repo or PR that failed. */
  errors: string[];
}

/** One open PR that you opened, for the list of your own PRs and stacks. */
export type AuthoredPr = PathPr & Pick<StackPrSummary, "title" | "url" | "updatedAt">;

/** GET /api/repos/:owner/:name/authored: your open PRs in the repo, newest update first. */
export interface AuthoredResponse {
  repo: string;
  /** The GitHub login the token belongs to. */
  viewer: string;
  prs: AuthoredPr[];
}

export interface ApiError {
  error: string;
}

export interface CreateThreadRequest {
  title?: string;
}

/** GET /api/changes/:id/file: one file of a Change at a revision its report names. */
export interface FileResponse {
  path: string;
  revision: string;
  content: string;
}

/** Claude requests and their estimated cost, for one group of usage-log lines. */
export interface UsageTotals {
  /** Requests sent to Claude. */
  requests: number;
  /** Answers read from Strata's own cache; Claude was not asked. */
  cached: number;
  /** Input tokens, cache reads and cache writes included. */
  inputTokens: number;
  outputTokens: number;
  /** Strata's estimate from token counts and list prices, in US dollars. */
  costUsd: number;
  /** Requests to a model whose price Strata does not know; not in costUsd. */
  unpriced: number;
}

/** One feature: a task name in the usage log, such as "pr-summary". */
export interface UsageTaskRow extends UsageTotals {
  task: string;
  models: string[];
}

export interface UsageModelRow extends UsageTotals {
  model: string;
}

/** One UTC day, with the cost of each task on that day. */
export interface UsageDayRow extends UsageTotals {
  day: string;
  costByTask: Record<string, number>;
}

/** One Change, or `changeId: null` for log lines that do not name one. */
export interface UsageChangeRow extends UsageTotals {
  changeId: string | null;
  repo: string | null;
  /** The Change's title, when the server still has the Change. */
  title: string | null;
}

/** What Strata sent to Claude in a period, grouped four ways. Every list is sorted by cost, days newest first. */
export interface UsageSummary {
  /** ISO time; the period runs from here to now. */
  since: string;
  total: UsageTotals;
  byTask: UsageTaskRow[];
  byModel: UsageModelRow[];
  byDay: UsageDayRow[];
  byChange: UsageChangeRow[];
}

/** The real spend from Anthropic's Admin API, for the server's API key or the whole organization. */
export interface BilledCost {
  costUsd: number;
  scope: "key" | "organization";
}

/** GET /api/usage?days=7|30|90 */
export interface UsageResponse extends UsageSummary {
  days: number;
  /** Null when the server has no admin key, or Anthropic did not answer (see billedError). */
  billed: BilledCost | null;
  billedError: string | null;
}

/**
 * HTTP contract between `apps/server` and `apps/web`. Both import these types,
 * so a change here is a compile error on both sides rather than a runtime 404.
 */
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

export interface ChangeSummary {
  id: string;
  title: string;
  repo: string;
  input: string;
  status: RunStatus | null;
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

export interface ApiError {
  error: string;
}

export interface CreateThreadRequest {
  title?: string;
}

/**
 * HTTP contract between `apps/server` and `apps/web`. Both import these types,
 * so a change here is a compile error on both sides rather than a runtime 404.
 */
import type { ContextKind, ContextSource } from "./context.js";
import type { ChangeReport } from "./report.js";

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
  sources?: NewContextSource[];
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

/**
 * Stacks: ordinary PRs whose branches feed into each other.
 *
 * The bottom PR targets the trunk (usually main), and each PR above it targets
 * the head branch of the PR below. Linear infers stacks the same way, and PRs
 * in GitHub's native stacks are linked like this too, so the same branch links
 * find both; GitHub's own stack records are not read.
 *
 * A stack is a tree: two PRs on one base make a fork, and each path from the
 * bottom to a tip is one Change. The stack describes how the code arrived, so
 * like `ChangeHint` it must never decide layers, diagrams or findings.
 */
import type { Evidence } from "./change.js";

export type PrState = "open" | "merged" | "closed";

/** One PR as the GitHub index reports it. Metadata only, no diff. */
export interface StackPr {
  number: number;
  title: string;
  url: string;
  /** GitHub login; null for deleted accounts. */
  author: string | null;
  state: PrState;
  draft: boolean;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  /** The branch the PR targets now. */
  baseRef: string;
  headRef: string;
  /** The head commit; for a merged or closed PR, its last head. */
  headOid: string;
  /** True when the head branch lives in a fork. Such a PR can't be a parent. */
  crossRepository: boolean;
  /** For merged PRs: the merge, squash or last rebased commit on the base. */
  mergeCommitOid: string | null;
  /** Every change of base branch, oldest first. */
  baseChanges: BaseChange[];
  /** Every force-push of the head branch, oldest first. */
  forcePushes: ForcePush[];
  review: "approved" | "changes-requested" | "review-required" | null;
  checks: "success" | "failure" | "pending" | null;
}

export interface BaseChange {
  from: string;
  to: string;
  at: string;
}

export interface ForcePush {
  before: string;
  after: string;
  at: string;
}

/** The PRs Strata knows about in one repo. */
export interface PrIndex {
  /** `owner/name`. */
  repo: string;
  defaultBranch: string;
  prs: StackPr[];
}

/** Where to start looking: a PR, or a branch with a PR on it. */
export type StackSeed = { pr: number; leaf?: number } | { branch: string; leaf?: number };

/**
 * Git facts the stack builder needs, answered by the engine. Keys join the two
 * object ids with a space: `"<a> <b>"`. A null answer means git couldn't tell,
 * usually because a commit isn't in the local cache.
 */
export interface GitFacts {
  /** Whether `a` is an ancestor of `b` (a commit is its own ancestor). */
  isAncestor: Record<string, boolean | null>;
  /** The merge base of `a` and `b`; null when they share no history. */
  mergeBase: Record<string, string | null>;
  /** A commit's first parent. */
  firstParent: Record<string, string | null>;
  /** A branch's tip now; null when the branch is gone. */
  tip: Record<string, string | null>;
}

export type FactRequest =
  | { kind: "is-ancestor"; a: string; b: string }
  | { kind: "merge-base"; a: string; b: string }
  | { kind: "first-parent"; oid: string }
  | { kind: "tip"; ref: string };

/**
 * How a PR's head relates to its parent's head. Each state fixes where the
 * PR's own diff starts (`StackNode.anchor`).
 *
 * - `intact`: the parent's head is in the PR. Its diff starts at that head.
 * - `behind`: the parent got new commits after the PR branched. Its diff
 *   starts where the two last met, and it needs a restack.
 * - `stale`: the PR sits on a head the parent force-pushed away. Its diff
 *   starts at that old head, and it needs a restack.
 * - `re-anchored`: the PR was rebased somewhere else, usually onto the trunk
 *   after the parent merged. Its diff starts where it left its current base.
 * - `merged-into-parent`: the PR was merged into the parent's branch, so the
 *   parent's head already holds it.
 * - `unknown`: git couldn't answer, usually because a commit is missing.
 */
export type LinkState =
  | "intact"
  | "behind"
  | "stale"
  | "re-anchored"
  | "merged-into-parent"
  | "unknown";

export interface StackEdge {
  parent: number;
  child: number;
  /** `base-ref` when the child targets the parent's branch now; `retarget` when it used to. */
  via: "base-ref" | "retarget";
  /** The branch that links them: the parent's head branch. */
  ref: string;
  link: LinkState;
  evidence: Evidence[];
}

export type StackIssueKind =
  | "ambiguous-parent"
  | "cycle"
  | "non-default-trunk"
  | "base-already-merged"
  | "needs-restack"
  | "missing-commit";

export interface StackIssue {
  kind: StackIssueKind;
  prs: number[];
  message: string;
  evidence: Evidence[];
}

export interface StackNode {
  pr: StackPr;
  parent: number | null;
  /** Ascending by PR number. */
  children: number[];
  /** 0 for the bottom PR. */
  depth: number;
  /** Where this PR's own diff starts; null when git couldn't tell. */
  anchor: string | null;
}

export interface Stack {
  /** Derived from the repo and the bottom PR, so it survives new PRs on top. */
  id: string;
  repo: string;
  trunk: { name: string; isDefault: boolean };
  /** The bottom PR. */
  root: number;
  /** Where the stack left the trunk: the start of the whole-stack diff. */
  base: string | null;
  /** Depth first from the bottom, siblings by PR number. */
  nodes: StackNode[];
  edges: StackEdge[];
  /** Every bottom-to-tip path, bottom first. */
  paths: number[][];
  /** The path this Change covers: through the seed, to the chosen tip. */
  selectedPath: number[];
  seed: number;
  issues: StackIssue[];
}

export type BuildStackResult =
  | { kind: "done"; stack: Stack }
  /** Answer these with git, merge them into the facts, and call again. */
  | { kind: "needs"; requests: FactRequest[] };

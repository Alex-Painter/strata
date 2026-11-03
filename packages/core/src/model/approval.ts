/**
 * Approving PRs from Strata. GitHub keeps the reviews; Strata reads the
 * viewer's latest review of each PR and decides, from those facts alone,
 * whether the Approve action is open. An approval names the head commit that
 * Strata analysed, so the reviewer approves only the code that Strata showed.
 */
import type { PrState, StackPr } from "./stack.js";

/** One PR as GitHub shows it to the token's user now. */
export interface LivePr {
  number: number;
  url: string;
  state: PrState;
  draft: boolean;
  author: string | null;
  headOid: string;
  review: StackPr["review"];
  /** The token's user's latest review of the PR, if any. */
  viewerReview: ViewerReview | null;
}

export interface ViewerReview {
  state: "approved" | "changes-requested" | "commented" | "dismissed" | "pending";
  /** The commit the review names; null when GitHub no longer has it. */
  commitOid: string | null;
  url: string;
  submittedAt: string | null;
}

export type ApprovalState =
  /** Open, not yours, and Strata analysed its head: Approve is open. */
  | { kind: "can-approve" }
  /** You approved its current head. */
  | { kind: "approved"; url: string; at: string | null }
  /** You approved an earlier commit; Approve again is open. */
  | { kind: "approved-earlier"; commitOid: string | null; url: string }
  /** The PR has commits that Strata did not analyse. */
  | { kind: "head-moved"; analysed: string | null; live: string }
  | { kind: "own" }
  | { kind: "draft" }
  | { kind: "closed"; state: Exclude<PrState, "open"> };

/**
 * What the Approve action can do for one PR. `analysedHead` is the head in
 * the report the reviewer sees; null when the report does not have the PR.
 */
export function approvalState(
  live: LivePr,
  analysedHead: string | null,
  viewer: string,
): ApprovalState {
  if (live.state !== "open") return { kind: "closed", state: live.state };
  if (live.author !== null && live.author.toLowerCase() === viewer.toLowerCase()) {
    return { kind: "own" };
  }
  const review = live.viewerReview;
  if (review?.state === "approved" && review.commitOid === live.headOid) {
    return { kind: "approved", url: review.url, at: review.submittedAt };
  }
  if (live.draft) return { kind: "draft" };
  if (analysedHead !== live.headOid) {
    return { kind: "head-moved", analysed: analysedHead, live: live.headOid };
  }
  if (review?.state === "approved") {
    return { kind: "approved-earlier", commitOid: review.commitOid, url: review.url };
  }
  return { kind: "can-approve" };
}

export function canApprove(state: ApprovalState): boolean {
  return state.kind === "can-approve" || state.kind === "approved-earlier";
}

/** One PR on a Change's path, with what the Approve action can do for it. */
export interface PrApproval {
  number: number;
  url: string;
  /** The head in the latest report: the commit an approval names. */
  analysedHead: string | null;
  liveHead: string;
  review: StackPr["review"];
  state: ApprovalState;
}

export interface ApprovalsResponse {
  /** The login that approvals go out as. */
  viewer: string;
  /** The path's PRs, bottom first. */
  prs: PrApproval[];
}

/**
 * The PRs that Approve stack approves, the PRs it skips and why, and whether
 * it is blocked. It is blocked while a PR on the path has commits that Strata
 * did not analyse, since the reviewer did not see the whole stack.
 */
export function stackApproval(prs: PrApproval[]): {
  approve: number[];
  skip: { number: number; reason: string }[];
  blocked: number[];
} {
  const approve: number[] = [];
  const skip: { number: number; reason: string }[] = [];
  const blocked: number[] = [];
  for (const pr of prs) {
    if (pr.state.kind === "head-moved") blocked.push(pr.number);
    else if (canApprove(pr.state)) approve.push(pr.number);
    else skip.push({ number: pr.number, reason: SKIP_REASON[pr.state.kind] ?? "" });
  }
  return { approve, skip, blocked };
}

const SKIP_REASON: Partial<Record<ApprovalState["kind"], string>> = {
  approved: "You approved it.",
  own: "It is your PR.",
  draft: "It is a draft.",
  closed: "It is not open.",
};

/** Ask the server to approve these PRs, each at the head the page shows. */
export interface ApproveRequest {
  prs: { number: number; headOid: string }[];
  /** True for Approve stack: the server refuses while a PR on the path has moved. */
  stack?: boolean;
}

export type ApproveResult =
  | { number: number; ok: true; url: string; commitOid: string }
  | { number: number; ok: false; error: string };

export interface ApproveResponse {
  results: ApproveResult[];
  /** The path's PRs, read again after the approvals. */
  approvals: ApprovalsResponse;
}

/** Why the Approve action is not open for a PR, as a sentence; null when it is open. */
export function approvalBlock(state: ApprovalState, pr: number): string | null {
  switch (state.kind) {
    case "can-approve":
    case "approved-earlier":
      return null;
    case "approved":
      return `You approved #${pr} at its current head.`;
    case "head-moved":
      return `#${pr} has new commits. Run Strata again before you approve it.`;
    case "own":
      return `#${pr} is your PR. GitHub does not permit you to approve it.`;
    case "draft":
      return `#${pr} is a draft. GitHub does not permit approval yet.`;
    case "closed":
      return `#${pr} is ${state.state}.`;
  }
}

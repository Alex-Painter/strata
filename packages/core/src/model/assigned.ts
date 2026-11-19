/**
 * PRs GitHub lists for you: you're an assignee, your review is requested
 * (directly or through a team), or you've reviewed it already. Strata turns each into the Change for its path,
 * the same Change you'd get by typing the PR in.
 */

import type { PathPr } from "./api.js";

export type AssignedReason =
  | { kind: "assignee" }
  /** You've reviewed it already; it no longer waits on you unless another reason says so. */
  | { kind: "reviewed" }
  /**
   * `direct` when you were asked by name; otherwise `teams` names the teams
   * that were asked (empty when the token can't see which).
   */
  | { kind: "review-requested"; direct: boolean; teams: string[] };

export interface AssignedPr {
  number: number;
  title: string;
  url: string;
  headOid: string;
  updatedAt: string;
  /** At least one. */
  reasons: AssignedReason[];
}

export interface AssignedPrs {
  /** The GitHub login the token belongs to: the "you" in the reasons. */
  viewer: string;
  /** Open PRs, not your own, by number. */
  prs: AssignedPr[];
}

/**
 * Whether a PR waits on you. Once you have reviewed it, it waits only when
 * GitHub asks you by name again: a review removes your own request, so a
 * request by name after it is a new one. An assignment or a team request
 * does not make you review again.
 */
export function waitsOnYou(reasons: AssignedReason[]): boolean {
  if (reasons.some((r) => r.kind === "reviewed")) {
    return reasons.some((r) => r.kind === "review-requested" && r.direct);
  }
  return reasons.length > 0;
}

/**
 * True when the path has an open PR and every open PR on it is approved: by
 * GitHub's review decision, or by a reviewer's latest review, a bot's too,
 * with nobody asking for changes. Merged and closed PRs need nothing more.
 */
export function allApproved(prs: PathPr[]): boolean {
  const open = prs.filter((pr) => pr.state === "open");
  return open.length > 0 && open.every(isApproved);
}

function isApproved(pr: PathPr): boolean {
  if (pr.review === "changes-requested" || pr.latestReview === "changes-requested") return false;
  return pr.review === "approved" || pr.latestReview === "approved";
}

/**
 * PRs GitHub lists for you: you're an assignee, your review is requested
 * (directly or through a team), or you've reviewed it already. Strata turns each into the Change for its path,
 * the same Change you'd get by typing the PR in.
 */

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

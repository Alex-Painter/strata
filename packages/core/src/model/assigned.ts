/**
 * PRs GitHub lists for you: you're an assignee, or your review is requested,
 * directly or through a team. Strata turns each into the Change for its path,
 * the same Change you'd get by typing the PR in.
 */

export type AssignedReason =
  | { kind: "assignee" }
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

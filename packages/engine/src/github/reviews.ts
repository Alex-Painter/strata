/**
 * Reviews: what the token's user sees of a PR now, and the one write Strata
 * makes to GitHub, an approving review that names a commit. Strata sends it
 * only when a person asks for it.
 */
import type { LivePr, ViewerReview } from "@strata/core";
import { GitHubError, type GitHubPort } from "./port.js";
import { splitRepo } from "./pr-index.js";

export const PR_REVIEW_QUERY = `
query StrataPrReview($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number url state isDraft headRefOid reviewDecision
      author { login }
      viewerLatestReview { state url submittedAt commit { oid } }
    }
  }
}`;

export const APPROVE_MUTATION = `
mutation StrataApprove($id: ID!, $commit: GitObjectID!) {
  addPullRequestReview(input: { pullRequestId: $id, event: APPROVE, commitOID: $commit }) {
    pullRequestReview { url state commit { oid } }
  }
}`;

export interface ReviewNode {
  id: string;
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  headRefOid: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  author: { login: string } | null;
  viewerLatestReview: {
    state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
    url: string;
    submittedAt: string | null;
    commit: { oid: string } | null;
  } | null;
}

export interface ReviewPage {
  viewer: { login: string };
  repository: { pullRequest: ReviewNode | null } | null;
}

export interface ApprovePage {
  addPullRequestReview: {
    pullRequestReview: { url: string; state: string; commit: { oid: string } | null } | null;
  } | null;
}

export interface LivePrRead {
  viewer: string;
  pr: LivePr;
  /** GitHub's id for the PR, which the approval names. */
  nodeId: string;
}

const STATES = { OPEN: "open", MERGED: "merged", CLOSED: "closed" } as const;
const REVIEWS = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
} as const;
const VIEWER_REVIEWS: Record<string, ViewerReview["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};

export async function readLivePr(
  port: GitHubPort,
  repo: string,
  number: number,
): Promise<LivePrRead> {
  const [owner, name] = splitRepo(repo);
  const page = await port.graphql<ReviewPage>(PR_REVIEW_QUERY, { owner, name, number });
  const node = page.repository?.pullRequest;
  if (!node) throw new GitHubError(`GitHub cannot find ${repo}#${number}.`);
  const review = node.viewerLatestReview;
  return {
    viewer: page.viewer.login,
    nodeId: node.id,
    pr: {
      number: node.number,
      url: node.url,
      state: STATES[node.state],
      draft: node.isDraft,
      author: node.author?.login ?? null,
      headOid: node.headRefOid,
      review: node.reviewDecision ? REVIEWS[node.reviewDecision] : null,
      viewerReview: review
        ? {
            state: VIEWER_REVIEWS[review.state] ?? "commented",
            commitOid: review.commit?.oid ?? null,
            url: review.url,
            submittedAt: review.submittedAt,
          }
        : null,
    },
  };
}

/** Submits an approving review of `commitOid`. GitHub's refusal comes back as a GitHubError. */
export async function approvePr(
  port: GitHubPort,
  nodeId: string,
  commitOid: string,
): Promise<{ url: string; commitOid: string }> {
  const page = await port.graphql<ApprovePage>(APPROVE_MUTATION, { id: nodeId, commit: commitOid });
  const review = page.addPullRequestReview?.pullRequestReview;
  if (!review) throw new GitHubError("GitHub did not return the review.");
  return { url: review.url, commitOid: review.commit?.oid ?? commitOid };
}

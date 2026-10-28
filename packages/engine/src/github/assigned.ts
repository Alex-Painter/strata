/**
 * Open PRs in a repo that GitHub lists for the token's user: assigned to
 * them, or with their review requested directly or through a team they're
 * on. Their own PRs are left out. Two searches, since GitHub's search can't
 * OR the two qualifiers.
 */
import type { AssignedPr, AssignedPrs, AssignedReason } from "@strata/core";
import type { PageInfo } from "./graphql.js";
import { GitHubError, type GitHubPort } from "./port.js";
import { splitRepo } from "./pr-index.js";

export const ASSIGNED_QUERY = `
query StrataAssigned($q: String!, $cursor: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest {
        number title url updatedAt headRefOid
        repository { nameWithOwner }
        assignees(first: 50) { nodes { login } }
        reviewRequests(first: 50) {
          nodes { requestedReviewer { __typename ... on User { login } ... on Team { combinedSlug } } }
        }
      }
    }
  }
}`;

export type Reviewer =
  | { __typename: "User"; login: string }
  | { __typename: "Team"; combinedSlug: string }
  | { __typename: "Bot" | "Mannequin" };

export interface AssignedNode {
  __typename: "PullRequest";
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  headRefOid: string;
  repository: { nameWithOwner: string };
  assignees: { nodes: ({ login: string } | null)[] };
  reviewRequests: { nodes: ({ requestedReviewer: Reviewer | null } | null)[] };
}

export interface AssignedPage {
  viewer: { login: string };
  search: { pageInfo: PageInfo; nodes: (AssignedNode | { __typename: string } | null)[] };
}

/** The search qualifiers behind each reason. */
export const ASSIGNED_SEARCHES = {
  assignee: "assignee:@me",
  "review-requested": "review-requested:@me",
} as const;

export async function findAssigned(port: GitHubPort, repo: string): Promise<AssignedPrs> {
  splitRepo(repo);
  let viewer: string | null = null;
  const found = new Map<number, { node: AssignedNode; kinds: Set<AssignedReason["kind"]> }>();
  for (const [kind, qualifier] of Object.entries(ASSIGNED_SEARCHES) as [
    AssignedReason["kind"],
    string,
  ][]) {
    const q = `repo:${repo} is:pr is:open ${qualifier} -author:@me`;
    let cursor: string | null = null;
    for (;;) {
      const page: AssignedPage = await port.graphql<AssignedPage>(ASSIGNED_QUERY, { q, cursor });
      viewer = page.viewer.login;
      for (const node of page.search.nodes) {
        if (node?.__typename !== "PullRequest") continue;
        const pr = node as AssignedNode;
        // Search matches case-insensitively; a renamed repo can still match by its old name.
        if (pr.repository.nameWithOwner.toLowerCase() !== repo.toLowerCase()) continue;
        const entry = found.get(pr.number) ?? { node: pr, kinds: new Set() };
        entry.kinds.add(kind);
        found.set(pr.number, entry);
      }
      if (!page.search.pageInfo.hasNextPage) break;
      cursor = page.search.pageInfo.endCursor;
    }
  }
  if (viewer === null) throw new GitHubError("GitHub didn't say who the token belongs to.");
  const login = viewer;
  const prs = [...found.values()]
    .map(({ node, kinds }) => toAssignedPr(node, kinds, login))
    .sort((a, b) => a.number - b.number);
  return { viewer: login, prs };
}

function toAssignedPr(
  node: AssignedNode,
  kinds: Set<AssignedReason["kind"]>,
  viewer: string,
): AssignedPr {
  const same = (login: string) => login.toLowerCase() === viewer.toLowerCase();
  const reasons: AssignedReason[] = [];
  if (kinds.has("assignee")) reasons.push({ kind: "assignee" });
  if (kinds.has("review-requested")) {
    const reviewers = node.reviewRequests.nodes.flatMap((n) =>
      n?.requestedReviewer ? [n.requestedReviewer] : [],
    );
    const direct = reviewers.some((r) => r.__typename === "User" && same(r.login));
    const teams = direct
      ? []
      : reviewers.flatMap((r) => (r.__typename === "Team" ? [r.combinedSlug] : [])).sort();
    reasons.push({ kind: "review-requested", direct, teams });
  }
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    headOid: node.headRefOid,
    updatedAt: node.updatedAt,
    reasons,
  };
}

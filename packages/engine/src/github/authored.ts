/**
 * Open PRs in a repo that the token's user opened. One search, after asking
 * whose token it is. The web app groups them into stacks with the stack list.
 */
import type { AuthoredPr } from "@strata/core";
import { VIEWER_QUERY, type ViewerPage } from "./assigned.js";
import { CHECKS, type PageInfo, REVIEWS } from "./graphql.js";
import { GitHubError, type GitHubPort } from "./port.js";
import { splitRepo } from "./pr-index.js";

export const AUTHORED_QUERY = `
query StrataAuthored($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest {
        number title url isDraft createdAt updatedAt
        author { login }
        repository { nameWithOwner }
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

export interface AuthoredNode {
  __typename: "PullRequest";
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  commits: { nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] };
}

export interface AuthoredPage {
  search: { pageInfo: PageInfo; nodes: (AuthoredNode | { __typename: string } | null)[] };
}

export interface AuthoredPrs {
  /** The GitHub login the token belongs to. */
  viewer: string;
  /** Open PRs that the viewer opened, newest update first. */
  prs: AuthoredPr[];
}

export async function findAuthored(port: GitHubPort, repo: string): Promise<AuthoredPrs> {
  splitRepo(repo);
  const viewer = (await port.graphql<ViewerPage>(VIEWER_QUERY, {})).viewer?.login;
  if (!viewer) throw new GitHubError("GitHub did not give the owner of the token.");
  const q = `repo:${repo} is:pr is:open author:${viewer}`;
  const found = new Map<number, AuthoredPr>();
  let cursor: string | null = null;
  for (;;) {
    const page: AuthoredPage = await port.graphql<AuthoredPage>(AUTHORED_QUERY, { q, cursor });
    for (const node of page.search.nodes) {
      if (node?.__typename !== "PullRequest") continue;
      const pr = node as AuthoredNode;
      // Search matches case-insensitively; a renamed repo can still match by its old name.
      if (pr.repository.nameWithOwner.toLowerCase() !== repo.toLowerCase()) continue;
      found.set(pr.number, toAuthoredPr(pr));
    }
    if (!page.search.pageInfo.hasNextPage) break;
    cursor = page.search.pageInfo.endCursor;
  }
  const prs = [...found.values()].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number,
  );
  return { viewer, prs };
}

function toAuthoredPr(node: AuthoredNode): AuthoredPr {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup?.state;
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? null,
    state: "open",
    draft: node.isDraft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    review: node.reviewDecision ? REVIEWS[node.reviewDecision] : null,
    checks: rollup ? (CHECKS[rollup] ?? null) : null,
  };
}

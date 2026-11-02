/**
 * A stand-in for GitHub's GraphQL API that serves a fixed list of PRs the way
 * the real one does: newest-updated first, in pages, with cursors. It records
 * each query so tests can check how much was asked for.
 */
import {
  ASSIGNED_QUERY,
  type AssignedNode,
  type AssignedPage,
  VIEWER_QUERY,
  type ViewerPage,
} from "../github/assigned.js";
import {
  PR_PAGE_QUERY,
  PR_TIMELINE_QUERY,
  type PrNode,
  type PrPage,
  type PrTimelinePage,
  type TimelineNode,
} from "../github/graphql.js";
import { GitHubError, type GitHubPort } from "../github/port.js";
import {
  APPROVE_MUTATION,
  type ApprovePage,
  PR_REVIEW_QUERY,
  type ReviewNode,
  type ReviewPage,
} from "../github/reviews.js";
import type { VerificationNode, VerificationPage } from "../github/verification.js";

export interface FakeGitHub extends GitHubPort {
  calls: {
    query: "page" | "timeline" | "search" | "verification" | "review" | "approve";
    variables: Record<string, unknown>;
  }[];
  prs: PrNode[];
  /** The login the token belongs to. */
  viewer: string;
  /** Who each PR is assigned to and whose review it asks for, by PR number. */
  requests: Record<number, FakeRequests>;
  /** Checks, reviews, comments and bodies by PR number, for the verification query. */
  verification: Record<number, Partial<VerificationNode>>;
  /** Reviews by PR number, oldest first. Approvals sent through the fake land here. */
  reviews: Record<number, FakeReview[]>;
  /** An error GitHub gives for an approval of the PR, such as a missing permission. */
  refuseApproval: Record<number, string>;
}

export interface FakeReview {
  by: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  commit: string;
  submittedAt: string;
}

export interface FakeRequests {
  assignees?: string[];
  /** Who has reviewed it. */
  reviewedBy?: string[];
  reviewers?: string[];
  teams?: { slug: string; members: string[] }[];
}

export function fakeGitHub(
  repo: string,
  prs: PrNode[],
  options: {
    defaultBranch?: string;
    pageSize?: number;
    timelinePageSize?: number;
    viewer?: string;
  } = {},
): FakeGitHub {
  const pageSize = options.pageSize ?? 50;
  const timelinePageSize = options.timelinePageSize ?? 50;
  const fake: FakeGitHub = {
    calls: [],
    prs,
    viewer: options.viewer ?? "reviewer",
    requests: {},
    verification: {},
    reviews: {},
    refuseApproval: {},
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      if (query === VIEWER_QUERY) {
        const page: ViewerPage = { viewer: { login: fake.viewer } };
        return page as T;
      }
      if (query === ASSIGNED_QUERY) {
        fake.calls.push({ query: "search", variables });
        return search(fake, repo, String(variables.q), variables.cursor, pageSize) as T;
      }
      if (query === APPROVE_MUTATION) {
        fake.calls.push({ query: "approve", variables });
        return approve(fake, repo, String(variables.id), String(variables.commit)) as T;
      }
      if (query === PR_REVIEW_QUERY) {
        fake.calls.push({ query: "review", variables });
        const node = fake.prs.find((pr) => pr.number === variables.number);
        const page: ReviewPage = {
          viewer: { login: fake.viewer },
          repository:
            `${variables.owner}/${variables.name}` === repo
              ? { pullRequest: node ? reviewNode(fake, repo, node) : null }
              : null,
        };
        return page as T;
      }
      if (`${variables.owner}/${variables.name}` !== repo) {
        return { repository: null } as T;
      }
      if (query === PR_PAGE_QUERY) {
        fake.calls.push({ query: "page", variables });
        const sorted = [...fake.prs].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number,
        );
        const start = variables.cursor ? Number(variables.cursor) : 0;
        const nodes = sorted.slice(start, start + pageSize).map((node) => ({
          ...node,
          timelineItems: timelinePage(node.timelineItems.nodes, 0, timelinePageSize),
        }));
        const end = start + nodes.length;
        const page: PrPage = {
          repository: {
            defaultBranchRef: { name: options.defaultBranch ?? "main" },
            pullRequests: {
              pageInfo: { hasNextPage: end < sorted.length, endCursor: String(end) },
              nodes,
            },
          },
        };
        return page as T;
      }
      if (query === PR_TIMELINE_QUERY) {
        fake.calls.push({ query: "timeline", variables });
        const node = fake.prs.find((pr) => pr.number === variables.number);
        const start = variables.cursor ? Number(variables.cursor) : 0;
        const page: PrTimelinePage = {
          repository: {
            pullRequest: node
              ? { timelineItems: timelinePage(node.timelineItems.nodes, start, 100) }
              : null,
          },
        };
        return page as T;
      }
      if (query.startsWith("query StrataVerification")) {
        fake.calls.push({ query: "verification", variables });
        const page: VerificationPage = { repository: {} };
        for (const match of query.matchAll(/pr(\d+): pullRequest/g)) {
          const n = Number(match[1]);
          const node = fake.prs.find((pr) => pr.number === n);
          (page.repository as Record<string, VerificationNode | null>)[`pr${n}`] = node
            ? verificationNode(node, fake.verification[n] ?? {})
            : null;
        }
        return page as T;
      }
      throw new Error("The fake GitHub doesn't know this query.");
    },
  };
  return fake;
}

function reviewNode(fake: FakeGitHub, repo: string, pr: PrNode): ReviewNode {
  const mine = (fake.reviews[pr.number] ?? []).filter(
    (review) => review.by.toLowerCase() === fake.viewer.toLowerCase(),
  );
  const latest = mine[mine.length - 1];
  return {
    id: `PR_${pr.number}`,
    number: pr.number,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    headRefOid: pr.headRefOid,
    reviewDecision: pr.reviewDecision,
    author: pr.author,
    viewerLatestReview: latest
      ? {
          state: latest.state,
          url: `https://github.com/${repo}/pull/${pr.number}#pullrequestreview-${mine.length}`,
          submittedAt: latest.submittedAt,
          commit: { oid: latest.commit },
        }
      : null,
  };
}

/** Acts as GitHub does: refuses the author's own PR, and records the review. */
function approve(fake: FakeGitHub, repo: string, id: string, commit: string): ApprovePage {
  const pr = fake.prs.find((node) => `PR_${node.number}` === id);
  if (!pr) throw new Error(`Could not resolve to a node with the global id of '${id}'`);
  const refusal = fake.refuseApproval[pr.number];
  // GitHub answers with GraphQL errors, which the real port turns into GitHubErrors.
  if (refusal) throw new GitHubError(refusal);
  if (pr.author?.login.toLowerCase() === fake.viewer.toLowerCase()) {
    throw new GitHubError("Review Can not approve your own pull request");
  }
  const submittedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const reviews = fake.reviews[pr.number] ?? [];
  fake.reviews[pr.number] = reviews;
  reviews.push({ by: fake.viewer, state: "APPROVED", commit, submittedAt });
  pr.reviewDecision = "APPROVED";
  pr.updatedAt = submittedAt;
  const count = reviews.filter((r) => r.by === fake.viewer).length;
  return {
    addPullRequestReview: {
      pullRequestReview: {
        url: `https://github.com/${repo}/pull/${pr.number}#pullrequestreview-${count}`,
        state: "APPROVED",
        commit: { oid: commit },
      },
    },
  };
}

/** Understands only the searches findAssigned sends, for the viewer's own login. */
function search(
  fake: FakeGitHub,
  repo: string,
  q: string,
  cursor: unknown,
  pageSize: number,
): AssignedPage {
  const terms = q.toLowerCase().split(/\s+/);
  const me = fake.viewer.toLowerCase();
  const matches = fake.prs.filter((pr) => {
    const asks = fake.requests[pr.number] ?? {};
    const has = (list: string[] | undefined) => (list ?? []).some((l) => l.toLowerCase() === me);
    if (!terms.includes(`repo:${repo.toLowerCase()}`)) return false;
    if (terms.includes("is:open") && pr.state !== "OPEN") return false;
    if (terms.includes(`-author:${me}`) && pr.author?.login.toLowerCase() === me) return false;
    if (terms.includes(`assignee:${me}`) && !has(asks.assignees)) return false;
    if (terms.includes(`reviewed-by:${me}`) && !has(asks.reviewedBy)) return false;
    if (
      terms.includes(`review-requested:${me}`) &&
      !has(asks.reviewers) &&
      !(asks.teams ?? []).some((team) => has(team.members))
    )
      return false;
    return true;
  });
  const sorted = matches.sort((a, b) => b.number - a.number);
  const start = cursor ? Number(cursor) : 0;
  const nodes: AssignedNode[] = sorted.slice(start, start + pageSize).map((pr) => {
    const asks = fake.requests[pr.number] ?? {};
    return {
      __typename: "PullRequest",
      number: pr.number,
      title: pr.title,
      url: pr.url,
      updatedAt: pr.updatedAt,
      headRefOid: pr.headRefOid,
      repository: { nameWithOwner: repo },
      assignees: { nodes: (asks.assignees ?? []).map((login) => ({ login })) },
      reviewRequests: {
        nodes: [
          ...(asks.reviewers ?? []).map((login) => ({
            requestedReviewer: { __typename: "User" as const, login },
          })),
          ...(asks.teams ?? []).map((team) => ({
            requestedReviewer: { __typename: "Team" as const, combinedSlug: team.slug },
          })),
        ],
      },
    };
  });
  const end = start + nodes.length;
  return {
    search: { pageInfo: { hasNextPage: end < sorted.length, endCursor: String(end) }, nodes },
  };
}

function timelinePage(events: (TimelineNode | null)[], start: number, size: number) {
  const nodes = events.slice(start, start + size);
  const end = start + nodes.length;
  return { pageInfo: { hasNextPage: end < events.length, endCursor: String(end) }, nodes };
}

const T0 = Date.UTC(2026, 9, 1);
/** GitHub's timestamp format: whole seconds, `Z`. */
export const ghTime = (minute: number) =>
  new Date(T0 + minute * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A PR as GitHub's GraphQL API returns it, open on `main` unless told otherwise. */
export function prNode(number: number, headRefOid: string, fields: Partial<PrNode> = {}): PrNode {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    author: { login: "dev" },
    state: "OPEN",
    isDraft: false,
    createdAt: ghTime(number),
    updatedAt: ghTime(number),
    mergedAt: null,
    closedAt: null,
    baseRefName: "main",
    baseRefOid: null,
    headRefName: `b${number}`,
    headRefOid,
    isCrossRepository: false,
    mergeCommit: null,
    reviewDecision: null,
    commits: { nodes: [] },
    timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    ...fields,
  };
}

export const retargeted = (from: string, to: string, minute: number): TimelineNode => ({
  __typename: "BaseRefChangedEvent",
  createdAt: ghTime(minute),
  previousRefName: from,
  currentRefName: to,
});

export const forcePushed = (before: string, after: string, minute: number): TimelineNode => ({
  __typename: "HeadRefForcePushedEvent",
  createdAt: ghTime(minute),
  beforeCommit: { oid: before },
  afterCommit: { oid: after },
});

/** A PR's verification node: its own fields, then whatever the test gave for it. */
function verificationNode(pr: PrNode, given: Partial<VerificationNode>): VerificationNode {
  return {
    number: pr.number,
    url: pr.url,
    body: null,
    createdAt: pr.createdAt,
    lastEditedAt: null,
    headRefOid: pr.headRefOid,
    commits: {
      nodes: [
        {
          commit: {
            oid: pr.headRefOid,
            committedDate: pr.createdAt,
            statusCheckRollup: null,
            deployments: null,
          },
        },
      ],
    },
    latestReviews: null,
    reviews: null,
    comments: null,
    ...given,
  };
}

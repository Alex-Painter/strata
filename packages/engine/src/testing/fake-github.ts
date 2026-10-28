/**
 * A stand-in for GitHub's GraphQL API that serves a fixed list of PRs the way
 * the real one does: newest-updated first, in pages, with cursors. It records
 * each query so tests can check how much was asked for.
 */
import { ASSIGNED_QUERY, type AssignedNode, type AssignedPage } from "../github/assigned.js";
import {
  PR_PAGE_QUERY,
  PR_TIMELINE_QUERY,
  type PrNode,
  type PrPage,
  type PrTimelinePage,
  type TimelineNode,
} from "../github/graphql.js";
import type { GitHubPort } from "../github/port.js";

export interface FakeGitHub extends GitHubPort {
  calls: { query: "page" | "timeline" | "search"; variables: Record<string, unknown> }[];
  prs: PrNode[];
  /** The login the token belongs to. */
  viewer: string;
  /** Who each PR is assigned to and whose review it asks for, by PR number. */
  requests: Record<number, FakeRequests>;
}

export interface FakeRequests {
  assignees?: string[];
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
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      if (query === ASSIGNED_QUERY) {
        fake.calls.push({ query: "search", variables });
        return search(fake, repo, String(variables.q), variables.cursor, pageSize) as T;
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
      throw new Error("The fake GitHub doesn't know this query.");
    },
  };
  return fake;
}

/** Understands only the searches findAssigned sends. */
function search(
  fake: FakeGitHub,
  repo: string,
  q: string,
  cursor: unknown,
  pageSize: number,
): AssignedPage {
  const terms = q.split(/\s+/);
  const me = fake.viewer.toLowerCase();
  const matches = fake.prs.filter((pr) => {
    const asks = fake.requests[pr.number] ?? {};
    const has = (list: string[] | undefined) => (list ?? []).some((l) => l.toLowerCase() === me);
    if (!terms.includes(`repo:${repo}`)) return false;
    if (terms.includes("is:open") && pr.state !== "OPEN") return false;
    if (terms.includes("-author:@me") && pr.author?.login.toLowerCase() === me) return false;
    if (terms.includes("assignee:@me") && !has(asks.assignees)) return false;
    if (
      terms.includes("review-requested:@me") &&
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
    viewer: { login: fake.viewer },
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

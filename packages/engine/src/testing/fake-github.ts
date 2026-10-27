/**
 * A stand-in for GitHub's GraphQL API that serves a fixed list of PRs the way
 * the real one does: newest-updated first, in pages, with cursors. It records
 * each query so tests can check how much was asked for.
 */
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
  calls: { query: "page" | "timeline"; variables: Record<string, unknown> }[];
  prs: PrNode[];
}

export function fakeGitHub(
  repo: string,
  prs: PrNode[],
  options: { defaultBranch?: string; pageSize?: number; timelinePageSize?: number } = {},
): FakeGitHub {
  const pageSize = options.pageSize ?? 50;
  const timelinePageSize = options.timelinePageSize ?? 50;
  const fake: FakeGitHub = {
    calls: [],
    prs,
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
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

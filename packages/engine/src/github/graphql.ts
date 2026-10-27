/**
 * The GraphQL queries behind the PR index, and the mapping from GitHub's
 * shapes to the core model. Retarget events only exist in GraphQL (the REST
 * timeline doesn't name the old base), which is why the index uses it.
 */
import type { BaseChange, ForcePush, StackPr } from "@strata/core";

const TIMELINE_FIELDS = `
  pageInfo { hasNextPage endCursor }
  nodes {
    __typename
    ... on BaseRefChangedEvent { createdAt previousRefName currentRefName }
    ... on HeadRefForcePushedEvent { createdAt beforeCommit { oid } afterCommit { oid } }
  }`;

const TIMELINE_ITEMS = "itemTypes: [BASE_REF_CHANGED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT]";

/** Newest-updated first, so a refresh can stop once it reaches what it has. */
export const PR_PAGE_QUERY = `
query StrataPrPage($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    pullRequests(first: 50, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url
        author { login }
        state isDraft createdAt updatedAt mergedAt closedAt
        baseRefName baseRefOid headRefName headRefOid isCrossRepository
        mergeCommit { oid }
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        timelineItems(first: 50, ${TIMELINE_ITEMS}) {${TIMELINE_FIELDS}
        }
      }
    }
  }
}`;

/** The rest of one PR's events, for the rare PR with more than one page. */
export const PR_TIMELINE_QUERY = `
query StrataPrTimeline($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      timelineItems(first: 100, after: $cursor, ${TIMELINE_ITEMS}) {${TIMELINE_FIELDS}
      }
    }
  }
}`;

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export type TimelineNode =
  | {
      __typename: "BaseRefChangedEvent";
      createdAt: string;
      previousRefName: string;
      currentRefName: string;
    }
  | {
      __typename: "HeadRefForcePushedEvent";
      createdAt: string;
      beforeCommit: { oid: string } | null;
      afterCommit: { oid: string } | null;
    };

export interface Timeline {
  pageInfo: PageInfo;
  nodes: (TimelineNode | null)[];
}

export interface PrNode {
  number: number;
  title: string;
  url: string;
  author: { login: string } | null;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  baseRefName: string;
  baseRefOid: string | null;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  mergeCommit: { oid: string } | null;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  commits: {
    nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[];
  };
  timelineItems: Timeline;
}

export interface PrPage {
  repository: {
    defaultBranchRef: { name: string } | null;
    pullRequests: { pageInfo: PageInfo; nodes: (PrNode | null)[] };
  } | null;
}

export interface PrTimelinePage {
  repository: { pullRequest: { timelineItems: Timeline } | null } | null;
}

const STATES = { OPEN: "open", MERGED: "merged", CLOSED: "closed" } as const;

const REVIEWS = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
} as const;

const CHECKS: Record<string, StackPr["checks"]> = {
  SUCCESS: "success",
  FAILURE: "failure",
  ERROR: "failure",
  PENDING: "pending",
  EXPECTED: "pending",
};

/** Maps one PR, given all of its timeline events oldest first. */
export function toStackPr(node: PrNode, events: (TimelineNode | null)[]): StackPr {
  const baseChanges: BaseChange[] = [];
  const forcePushes: ForcePush[] = [];
  for (const event of events) {
    if (event?.__typename === "BaseRefChangedEvent") {
      baseChanges.push({
        from: event.previousRefName,
        to: event.currentRefName,
        at: event.createdAt,
      });
    } else if (event?.__typename === "HeadRefForcePushedEvent") {
      // GitHub drops a side when the commit is gone; such a push can't anchor anything.
      if (event.beforeCommit && event.afterCommit) {
        forcePushes.push({
          before: event.beforeCommit.oid,
          after: event.afterCommit.oid,
          at: event.createdAt,
        });
      }
    }
  }
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup?.state;
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? null,
    state: STATES[node.state],
    draft: node.isDraft,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    mergedAt: node.mergedAt,
    closedAt: node.closedAt,
    baseRef: node.baseRefName,
    baseOid: node.baseRefOid,
    headRef: node.headRefName,
    headOid: node.headRefOid,
    crossRepository: node.isCrossRepository,
    mergeCommitOid: node.mergeCommit?.oid ?? null,
    baseChanges,
    forcePushes,
    review: node.reviewDecision ? REVIEWS[node.reviewDecision] : null,
    checks: rollup ? (CHECKS[rollup] ?? null) : null,
  };
}

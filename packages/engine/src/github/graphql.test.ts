import { describe, expect, it } from "vitest";
import page from "./fixtures/pr-page.json" with { type: "json" };
import { type PrNode, type PrPage, toStackPr } from "./graphql.js";

/** A page in the exact shape GitHub returns, nulls included. */
const nodes = ((page as PrPage).repository?.pullRequests.nodes ?? []).filter(
  (node): node is PrNode => node !== null,
);
const byNumber = (n: number) => {
  const node = nodes.find((pr) => pr.number === n) as PrNode;
  return toStackPr(node, node.timelineItems.nodes);
};

describe("toStackPr", () => {
  it("maps an open PR with its retarget and force-push events, oldest first", () => {
    expect(byNumber(102)).toEqual({
      number: 102,
      title: "Add the forecast service",
      url: "https://github.com/acme/app/pull/102",
      author: "dev-a",
      state: "open",
      draft: false,
      createdAt: "2026-10-20T09:00:00Z",
      updatedAt: "2026-10-23T16:12:41Z",
      mergedAt: null,
      closedAt: null,
      baseRef: "main",
      baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      headRef: "forecast/service",
      headOid: "2222222222222222222222222222222222222222",
      crossRepository: false,
      mergeCommitOid: null,
      baseChanges: [{ from: "forecast/model", to: "main", at: "2026-10-22T10:00:00Z" }],
      // The push whose old head GitHub no longer has is dropped: it can't anchor anything.
      forcePushes: [
        {
          before: "2222222222222222222222222222222222222220",
          after: "2222222222222222222222222222222222222222",
          at: "2026-10-23T16:12:40Z",
        },
      ],
      review: "review-required",
      checks: "pending",
    });
  });

  it("maps a merged PR, a deleted author and a passing rollup", () => {
    expect(byNumber(101)).toMatchObject({
      author: null,
      state: "merged",
      mergedAt: "2026-10-22T09:59:58Z",
      mergeCommitOid: "5555555555555555555555555555555555555555",
      // Where main was when it merged.
      baseOid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      review: "approved",
      checks: "success",
      baseChanges: [],
      forcePushes: [],
    });
  });

  it("maps a closed draft from a fork, and an errored rollup as a failure", () => {
    expect(byNumber(99)).toMatchObject({
      state: "closed",
      draft: true,
      crossRepository: true,
      review: "changes-requested",
      checks: "failure",
    });
  });

  it("maps a PR with no commits or checks", () => {
    const node = { ...(nodes[0] as PrNode), commits: { nodes: [] }, reviewDecision: null };
    expect(toStackPr(node, [])).toMatchObject({ checks: null, review: null });
  });
});

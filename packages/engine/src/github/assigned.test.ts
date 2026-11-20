import { describe, expect, it } from "vitest";
import { fakeGitHub, ghTime, prNode } from "../testing/fake-github.js";
import { findAssigned } from "./assigned.js";

const oid = (n: number) => String(n).repeat(40).slice(0, 40);

describe("findAssigned", () => {
  it("finds assigned, review-requested and reviewed PRs, but not your own", async () => {
    const github = fakeGitHub(
      "acme/app",
      [
        prNode(1, oid(1)),
        prNode(2, oid(2)),
        prNode(3, oid(3)),
        prNode(4, oid(4)),
        prNode(5, oid(5), { author: { login: "Alex" } }),
        prNode(6, oid(6), { state: "MERGED" }),
        prNode(7, oid(7)),
        prNode(8, oid(8)),
      ],
      { viewer: "alex", pageSize: 2 },
    );
    github.requests = {
      1: { assignees: ["Alex"] },
      2: { reviewers: ["alex"], teams: [{ slug: "acme/backend", members: ["alex"] }] },
      3: {
        teams: [
          { slug: "acme/infra", members: ["sam"] },
          { slug: "acme/backend", members: ["alex"] },
        ],
      },
      4: { assignees: ["alex"], reviewers: ["alex"] },
      5: { assignees: ["alex"] },
      6: { assignees: ["alex"] },
      7: { assignees: ["sam"], reviewers: ["sam"] },
      8: { reviewedBy: ["alex", "sam"] },
    };

    const found = await findAssigned(github, "acme/app");

    expect(found.viewer).toBe("alex");
    expect(found.prs.map((pr) => [pr.number, pr.reasons])).toEqual([
      [1, [{ kind: "assignee" }]],
      [2, [{ kind: "review-requested", direct: true, teams: [], requestedAt: ghTime(3) }]],
      [
        3,
        [
          {
            kind: "review-requested",
            direct: false,
            teams: ["acme/backend", "acme/infra"],
            requestedAt: ghTime(4),
          },
        ],
      ],
      [
        4,
        [
          { kind: "assignee" },
          { kind: "review-requested", direct: true, teams: [], requestedAt: ghTime(5) },
        ],
      ],
      [8, [{ kind: "reviewed" }]],
    ]);
    expect(found.prs[0]).toMatchObject({ title: "PR 1", headOid: oid(1) });
    const queries = github.calls.map((call) => call.variables.q);
    expect(new Set(queries)).toEqual(
      new Set([
        "repo:acme/app is:pr is:open assignee:alex -author:alex",
        "repo:acme/app is:pr is:open review-requested:alex -author:alex",
        "repo:acme/app is:pr is:open reviewed-by:alex -author:alex",
      ]),
    );
  });

  it("returns no PRs when nothing is asked of you", async () => {
    const github = fakeGitHub("acme/app", [prNode(1, oid(1))], { viewer: "alex" });
    expect(await findAssigned(github, "acme/app")).toEqual({ viewer: "alex", prs: [] });
  });

  it("dates a request by the newest event aimed at you, not at others", async () => {
    const github = fakeGitHub("acme/app", [prNode(2, oid(2))], { viewer: "alex" });
    github.requests = { 2: { reviewers: ["alex"] } };
    const graphql = github.graphql.bind(github);
    github.graphql = (async (query: string, variables: Record<string, unknown>) => {
      const page = (await graphql(query, variables)) as {
        search?: { nodes: { timelineItems?: unknown }[] };
      };
      for (const node of page.search?.nodes ?? []) {
        node.timelineItems = {
          nodes: [
            { createdAt: ghTime(10), requestedReviewer: { __typename: "User", login: "Alex" } },
            // Asked again after a review: the clock restarts.
            { createdAt: ghTime(50), requestedReviewer: { __typename: "User", login: "alex" } },
            { createdAt: ghTime(90), requestedReviewer: { __typename: "User", login: "sam" } },
            {
              createdAt: ghTime(95),
              requestedReviewer: { __typename: "Team", combinedSlug: "acme/x" },
            },
            {},
            null,
          ],
        };
      }
      return page;
    }) as typeof github.graphql;

    const found = await findAssigned(github, "acme/app");

    expect(found.prs[0]?.reasons).toEqual([
      { kind: "review-requested", direct: true, teams: [], requestedAt: ghTime(50) },
    ]);
  });

  it("leaves the time out when GitHub gives no request event", async () => {
    const github = fakeGitHub("acme/app", [prNode(2, oid(2))], { viewer: "alex" });
    github.requests = { 2: { reviewers: ["alex"] } };
    const graphql = github.graphql.bind(github);
    github.graphql = (async (query: string, variables: Record<string, unknown>) => {
      const page = (await graphql(query, variables)) as {
        search?: { nodes: { timelineItems?: unknown }[] };
      };
      for (const node of page.search?.nodes ?? []) delete node.timelineItems;
      return page;
    }) as typeof github.graphql;

    const found = await findAssigned(github, "acme/app");

    expect(found.prs[0]?.reasons).toEqual([{ kind: "review-requested", direct: true, teams: [] }]);
  });
});

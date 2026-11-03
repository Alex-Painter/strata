import { describe, expect, it } from "vitest";
import { fakeGitHub, prNode } from "../testing/fake-github.js";
import { findAuthored } from "./authored.js";

const oid = (n: number) => String(n).repeat(40).slice(0, 40);

describe("findAuthored", () => {
  it("finds your open PRs, newest update first, with their review and checks", async () => {
    const github = fakeGitHub(
      "acme/app",
      [
        prNode(1, oid(1), { author: { login: "Alex" }, updatedAt: "2026-10-03T00:00:00Z" }),
        prNode(2, oid(2), {
          author: { login: "alex" },
          isDraft: true,
          reviewDecision: "CHANGES_REQUESTED",
          commits: { nodes: [{ commit: { statusCheckRollup: { state: "ERROR" } } }] },
          updatedAt: "2026-10-05T00:00:00Z",
        }),
        prNode(3, oid(3), { author: { login: "alex" }, state: "MERGED" }),
        prNode(4, oid(4), { author: { login: "sam" } }),
        prNode(5, oid(5), { author: { login: "alex" }, updatedAt: "2026-10-04T00:00:00Z" }),
      ],
      { viewer: "alex", pageSize: 2 },
    );

    const found = await findAuthored(github, "acme/app");

    expect(found.viewer).toBe("alex");
    expect(found.prs.map((pr) => pr.number)).toEqual([2, 5, 1]);
    expect(found.prs[0]).toMatchObject({
      title: "PR 2",
      author: "alex",
      state: "open",
      draft: true,
      review: "changes-requested",
      checks: "failure",
    });
    expect(new Set(github.calls.map((call) => call.variables.q))).toEqual(
      new Set(["repo:acme/app is:pr is:open author:alex"]),
    );
  });

  it("returns no PRs when you opened none", async () => {
    const github = fakeGitHub("acme/app", [prNode(1, oid(1))], { viewer: "alex" });
    expect((await findAuthored(github, "acme/app")).prs).toEqual([]);
  });
});

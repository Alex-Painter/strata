import { describe, expect, it } from "vitest";
import { fakeGitHub, prNode } from "../testing/fake-github.js";
import { createGitHubPort, GitHubError } from "./port.js";
import { APPROVE_MUTATION, approvePr, readLivePr } from "./reviews.js";

const oid = (n: number) => String(n).repeat(40).slice(0, 40);

describe("readLivePr", () => {
  it("reads the PR as the token's user sees it, with their latest review", async () => {
    const github = fakeGitHub(
      "acme/app",
      [prNode(4, oid(4), { reviewDecision: "REVIEW_REQUIRED", isDraft: true })],
      { viewer: "alex" },
    );
    github.reviews[4] = [
      { by: "sam", state: "APPROVED", commit: oid(4), submittedAt: "2026-11-01T09:00:00Z" },
      { by: "alex", state: "COMMENTED", commit: oid(3), submittedAt: "2026-11-01T10:00:00Z" },
      { by: "alex", state: "APPROVED", commit: oid(3), submittedAt: "2026-11-01T11:00:00Z" },
    ];
    const read = await readLivePr(github, "acme/app", 4);
    expect(read).toEqual({
      viewer: "alex",
      nodeId: "PR_4",
      pr: {
        number: 4,
        url: "https://github.com/acme/app/pull/4",
        state: "open",
        draft: true,
        author: "dev",
        headOid: oid(4),
        review: "review-required",
        viewerReview: {
          state: "approved",
          commitOid: oid(3),
          url: "https://github.com/acme/app/pull/4#pullrequestreview-2",
          submittedAt: "2026-11-01T11:00:00Z",
        },
      },
    });
  });

  it("says when GitHub cannot find the PR", async () => {
    const github = fakeGitHub("acme/app", []);
    await expect(readLivePr(github, "acme/app", 9)).rejects.toThrow(
      "GitHub cannot find acme/app#9.",
    );
  });
});

describe("approvePr", () => {
  it("sends one approving review that names the commit", async () => {
    const github = fakeGitHub("acme/app", [prNode(4, oid(4))], { viewer: "alex" });
    const read = await readLivePr(github, "acme/app", 4);
    expect(await approvePr(github, read.nodeId, oid(4))).toEqual({
      url: "https://github.com/acme/app/pull/4#pullrequestreview-1",
      commitOid: oid(4),
    });
    expect(github.calls.filter((c) => c.query === "approve")).toEqual([
      { query: "approve", variables: { id: "PR_4", commit: oid(4) } },
    ]);
    const after = await readLivePr(github, "acme/app", 4);
    expect(after.pr.review).toBe("approved");
    expect(after.pr.viewerReview).toMatchObject({ state: "approved", commitOid: oid(4) });
  });

  it("passes on GitHub's refusal", async () => {
    const github = fakeGitHub("acme/app", [prNode(4, oid(4), { author: { login: "alex" } })], {
      viewer: "alex",
    });
    const port = createGitHubPort({
      token: "t",
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        try {
          const data = await github.graphql(body.query, body.variables);
          return Response.json({ data });
        } catch (error) {
          return Response.json({ errors: [{ message: (error as Error).message }] });
        }
      },
    });
    const error = await approvePr(port, "PR_4", oid(4)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as Error).message).toContain("Can not approve your own pull request");
  });

  it("is the only mutation Strata sends, and it always approves", () => {
    expect(APPROVE_MUTATION).toContain("event: APPROVE");
    expect(APPROVE_MUTATION).toContain("commitOID: $commit");
  });
});

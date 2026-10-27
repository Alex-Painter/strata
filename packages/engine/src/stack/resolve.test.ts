import type { PrIndex, Stack, StackPr } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { git, gitEnv } from "../git/run.js";
import { StackRepo } from "../testing/stack-repo.js";
import { answerFacts, resolveStack } from "./resolve.js";

/**
 * The git-dependent cases from core's stack tests, against real repos: each
 * case builds the history with git, then checks the links and anchors that
 * resolveStack finds in it.
 */

const T0 = Date.UTC(2026, 9, 1);
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();

function pr(number: number, headOid: string, fields: Partial<StackPr> = {}): StackPr {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    author: "dev",
    state: "open",
    draft: false,
    createdAt: at(number),
    updatedAt: at(number),
    mergedAt: null,
    closedAt: null,
    baseRef: "main",
    headRef: `b${number}`,
    headOid,
    crossRepository: false,
    mergeCommitOid: null,
    baseOid: null,
    baseChanges: [],
    forcePushes: [],
    review: null,
    checks: null,
    ...fields,
  };
}

const indexOf = (...prs: StackPr[]): PrIndex => ({ repo: "acme/app", defaultBranch: "main", prs });
const anchors = (stack: Stack) => stack.nodes.map((node) => [node.pr.number, node.anchor]);
const links = (stack: Stack) => stack.edges.map((edge) => [edge.child, edge.link]);
const issueKinds = (stack: Stack) => stack.issues.map((issue) => issue.kind);

let repo: StackRepo;
beforeEach(async () => {
  repo = await StackRepo.create();
});
afterEach(() => repo.remove());

describe("resolveStack", () => {
  it("anchors an intact chain where it left main, even after main moves on", async () => {
    const m0 = await repo.tip("main");
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const h3 = await repo.commit("b3", "b2");
    await repo.commit("main");
    const index = indexOf(pr(1, h1), pr(2, h2, { baseRef: "b1" }), pr(3, h3, { baseRef: "b2" }));

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(stack.base).toBe(m0);
    expect(anchors(stack)).toEqual([
      [1, m0],
      [2, h1],
      [3, h2],
    ]);
    expect(links(stack)).toEqual([
      [2, "intact"],
      [3, "intact"],
    ]);
    expect(stack.selectedPath).toEqual([1, 2, 3]);
    expect(stack.issues).toEqual([]);
  });

  it("keeps a squash-merged parent, and a retargeted child still on its old head", async () => {
    const m0 = await repo.tip("main");
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const s1 = await repo.squashMerge("b1", "main");
    await repo.holdPr(1, h1);
    await repo.deleteBranch("b1");
    const index = indexOf(
      pr(1, h1, { state: "merged", mergedAt: at(30), mergeCommitOid: s1 }),
      pr(2, h2, { baseChanges: [{ from: "b1", to: "main", at: at(31) }] }),
    );

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(stack.base).toBe(m0);
    expect(stack.edges.map((edge) => [edge.via, edge.link])).toEqual([["retarget", "intact"]]);
    expect(anchors(stack)).toEqual([
      [1, m0],
      [2, h1],
    ]);
    expect(stack.issues).toEqual([]);
  });

  it("re-anchors a child rebased onto main after its parent squash-merged", async () => {
    const m0 = await repo.tip("main");
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const s1 = await repo.squashMerge("b1", "main");
    const h2r = await repo.rebase("b2", "main", h1);
    await repo.holdPr(1, h1);
    await repo.deleteBranch("b1");
    const index = indexOf(
      pr(1, h1, { state: "merged", mergedAt: at(30), mergeCommitOid: s1 }),
      pr(2, h2r, {
        baseChanges: [{ from: "b1", to: "main", at: at(31) }],
        forcePushes: [{ before: h2, after: h2r, at: at(32) }],
      }),
    );

    const stack = await resolveStack(index, { pr: 1 }, repo.dir);

    expect(stack.base).toBe(m0);
    expect(links(stack)).toEqual([[2, "re-anchored"]]);
    expect(anchors(stack)).toEqual([
      [1, m0],
      [2, s1],
    ]);
    expect(stack.issues).toEqual([]);
  });

  it("anchors a stack whose bottom landed with a merge commit", async () => {
    const m0 = await repo.tip("main");
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    await repo.commit("main");
    const mc = await repo.mergeCommit("b1", "main");
    const index = indexOf(
      pr(1, h1, { state: "merged", mergedAt: at(30), mergeCommitOid: mc }),
      pr(2, h2, { baseChanges: [{ from: "b1", to: "main", at: at(31) }] }),
    );

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(stack.base).toBe(m0);
    expect(anchors(stack)).toEqual([
      [1, m0],
      [2, h1],
    ]);
  });

  it("finds a child that is behind its parent", async () => {
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const h1b = await repo.commit("b1");
    const index = indexOf(pr(1, h1b), pr(2, h2, { baseRef: "b1" }));

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(links(stack)).toEqual([[2, "behind"]]);
    expect(anchors(stack)[1]).toEqual([2, h1]);
    expect(issueKinds(stack)).toEqual(["needs-restack"]);
  });

  it("finds a child left on a head its parent force-pushed away", async () => {
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const h1a = await repo.amend("b1");
    const index = indexOf(
      pr(1, h1a, { forcePushes: [{ before: h1, after: h1a, at: at(30) }] }),
      pr(2, h2, { baseRef: "b1" }),
    );

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(links(stack)).toEqual([[2, "stale"]]);
    expect(anchors(stack)[1]).toEqual([2, h1]);
    expect(issueKinds(stack)).toEqual(["needs-restack"]);
  });

  it("anchors a child merged into its parent's branch at the parent's head before the merge", async () => {
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    await repo.commit("b1");
    const mc = await repo.mergeCommit("b2", "b1");
    const index = indexOf(
      pr(1, mc),
      pr(2, h2, { baseRef: "b1", state: "merged", mergedAt: at(30), mergeCommitOid: mc }),
    );

    const stack = await resolveStack(index, { pr: 1 }, repo.dir);

    expect(links(stack)).toEqual([[2, "merged-into-parent"]]);
    expect(anchors(stack)[1]).toEqual([2, h1]);
    expect(stack.issues).toEqual([]);
  });

  it("reports a head the repo doesn't have instead of guessing", async () => {
    const h1 = await repo.commit("b1", "main");
    const index = indexOf(pr(1, h1), pr(2, "f".repeat(40), { baseRef: "b1" }));

    const stack = await resolveStack(index, { pr: 1 }, repo.dir);

    expect(links(stack)).toEqual([[2, "unknown"]]);
    expect(anchors(stack)[1]).toEqual([2, null]);
    expect(issueKinds(stack)).toEqual(["missing-commit"]);
  });

  it("looks up branch tips where the caller keeps them", async () => {
    const m0 = await repo.tip("main");
    await git(repo.dir, ["update-ref", "refs/remotes/origin/main", m0]);
    const m1 = await repo.commit("main");

    const facts = await answerFacts(
      repo.dir,
      [{ kind: "tip", ref: "main" }],
      (branch) => `refs/remotes/origin/${branch}`,
    );
    const local = await answerFacts(repo.dir, [{ kind: "tip", ref: "main" }]);

    expect(facts.tip).toEqual({ main: m0 });
    expect(local.tip).toEqual({ main: m1 });
  });
});

/** The files a PR's own diff touches, from its anchor to its head. */
async function ownFiles(stack: Stack, number: number): Promise<string[]> {
  const node = stack.nodes.find((n) => n.pr.number === number);
  if (!node?.anchor) return [];
  const out = await git(repo.dir, ["diff", "--name-only", node.anchor, node.pr.headOid]);
  return out.stdout.trim().split("\n").filter(Boolean);
}
const onlyFrom = (files: string[], branch: string) =>
  files.length > 0 && files.every((file) => file.startsWith(`${branch}-`));

describe("resolveStack after the parent lands or moves", () => {
  it("re-anchors a child rebased onto main after its parent landed with a merge commit", async () => {
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    await repo.commit("main");
    const mc = await repo.mergeCommit("b1", "main");
    const m2 = await repo.commit("main");
    const h2r = await repo.rebase("b2", "main", h1);
    await repo.holdPr(1, h1);
    await repo.deleteBranch("b1");
    const index = indexOf(
      pr(1, h1, { state: "merged", mergedAt: at(30), mergeCommitOid: mc }),
      pr(2, h2r, {
        baseChanges: [{ from: "b1", to: "main", at: at(31) }],
        forcePushes: [{ before: h2, after: h2r, at: at(32) }],
      }),
    );

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(links(stack)).toEqual([[2, "re-anchored"]]);
    expect(anchors(stack)[1]).toEqual([2, m2]);
    expect(onlyFrom(await ownFiles(stack, 2), "b2")).toBe(true);
  });

  it("re-anchors a child updated from main after its parent was squash-merged", async () => {
    await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const s1 = await repo.squashMerge("b1", "main");
    const m2 = await repo.commit("main");
    const h2u = await repo.mergeCommit("main", "b2");
    const index = indexOf(
      pr(1, await repo.tip("b1"), { state: "merged", mergedAt: at(30), mergeCommitOid: s1 }),
      pr(2, h2u, { baseChanges: [{ from: "b1", to: "main", at: at(31) }] }),
    );
    await repo.deleteBranch("b1");

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(links(stack)).toEqual([[2, "re-anchored"]]);
    expect(anchors(stack)[1]).toEqual([2, m2]);
    expect(onlyFrom(await ownFiles(stack, 2), "b2")).toBe(true);
    expect(h2).not.toBe(h2u);
  });

  it("finds a child stale after its parent pushed again and then rebased onto main", async () => {
    const m0 = await repo.tip("main");
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const h1b = await repo.commit("b1");
    await repo.commit("main");
    const h1x = await repo.rebase("b1", "main", m0);
    const index = indexOf(
      pr(1, h1x, { forcePushes: [{ before: h1b, after: h1x, at: at(30) }] }),
      pr(2, h2, { baseRef: "b1" }),
    );

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(links(stack)).toEqual([[2, "stale"]]);
    expect(anchors(stack)[1]).toEqual([2, h1]);
    expect(issueKinds(stack)).toEqual(["needs-restack"]);
    expect(onlyFrom(await ownFiles(stack, 2), "b2")).toBe(true);
  });

  it("finds a child stale after its parent squashed its own commits in place", async () => {
    const m0 = await repo.tip("main");
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const h1b = await repo.commit("b1");
    const h1s = await repo.squashBranch("b1", m0);
    const index = indexOf(
      pr(1, h1s, { forcePushes: [{ before: h1b, after: h1s, at: at(30) }] }),
      pr(2, h2, { baseRef: "b1" }),
    );

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(links(stack)).toEqual([[2, "stale"]]);
    expect(anchors(stack)[1]).toEqual([2, h1]);
  });

  it("finds a child behind a parent that merged main in", async () => {
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    const m1 = await repo.commit("main");
    const h1m = await repo.mergeCommit("main", "b1");
    const index = indexOf(pr(1, h1m), pr(2, h2, { baseRef: "b1" }));

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(stack.base).toBe(m1);
    expect(links(stack)).toEqual([[2, "behind"]]);
    expect(anchors(stack)[1]).toEqual([2, h1]);
    expect(issueKinds(stack)).toEqual(["needs-restack"]);
  });

  it("keeps a retargeted child behind, not on main, when its parent merged main and then squash-merged", async () => {
    const h1 = await repo.commit("b1", "main");
    const h2 = await repo.commit("b2", "b1");
    await repo.commit("main");
    const h1m = await repo.mergeCommit("main", "b1");
    const s1 = await repo.squashMerge("b1", "main");
    await repo.holdPr(1, h1m);
    await repo.deleteBranch("b1");
    const index = indexOf(
      pr(1, h1m, { state: "merged", mergedAt: at(30), mergeCommitOid: s1 }),
      pr(2, h2, { baseChanges: [{ from: "b1", to: "main", at: at(31) }] }),
    );

    const stack = await resolveStack(index, { pr: 2 }, repo.dir);

    expect(links(stack)).toEqual([[2, "behind"]]);
    expect(anchors(stack)[1]).toEqual([2, h1]);
    expect(onlyFrom(await ownFiles(stack, 2), "b2")).toBe(true);
  });
});

describe("answerFacts", () => {
  it("answers null when two commits have more than one best merge base", async () => {
    // Criss-cross: b1 and b2 each merge the other's earlier tip.
    const x = await repo.commit("b1", "main");
    const y = await repo.commit("b2", "main");
    const a = await repo.mergeCommit("b2", "b1");
    await git(repo.dir, ["checkout", "--quiet", "--detach", y]);
    await git(repo.dir, ["branch", "--quiet", "-f", "b3", y]);
    const b = await repo.mergeCommit(x, "b3");
    const all = await git(repo.dir, ["merge-base", "--all", a, b]);
    expect(all.stdout.trim().split("\n").sort()).toEqual([x, y].sort());

    const facts = await answerFacts(repo.dir, [{ kind: "merge-base", a, b }]);

    expect(facts.mergeBase).toEqual({ [`${a} ${b}`]: null });
  });

  it("answers null when git can't tell", async () => {
    const m0 = await repo.tip("main");
    const missing = "e".repeat(40);

    const facts = await answerFacts(repo.dir, [
      { kind: "is-ancestor", a: missing, b: m0 },
      { kind: "merge-base", a: m0, b: missing },
      { kind: "is-ancestor", a: "main", b: m0 },
      { kind: "first-parent", oid: m0 },
      { kind: "tip", ref: "gone" },
    ]);

    expect(facts.isAncestor).toEqual({ [`${missing} ${m0}`]: null, [`main ${m0}`]: null });
    expect(facts.mergeBase).toEqual({ [`${m0} ${missing}`]: null });
    expect(facts.firstParent).toEqual({ [m0]: null });
    expect(facts.tip).toEqual({ gone: null });
  });
});

describe("gitEnv", () => {
  it("drops the caller's GIT_ variables and shuts out user config and prompts", () => {
    const env = gitEnv({
      PATH: "/usr/bin",
      GIT_DIR: "/somewhere/else",
      GIT_CONFIG_GLOBAL: "/home/dev/.gitconfig",
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.attributesFile",
      GIT_CONFIG_VALUE_0: "/dev/null",
      GIT_CONFIG_KEY_1: "core.excludesFile",
      GIT_CONFIG_VALUE_1: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    });
  });

  it("keeps git in the repo it was pointed at", async () => {
    vi.stubEnv("GIT_DIR", "/nonexistent");
    try {
      const { code, stdout } = await git(repo.dir, ["rev-parse", "--verify", "main"]);
      expect(code).toBe(0);
      expect(stdout.trim()).toBe(await repo.tip("main"));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

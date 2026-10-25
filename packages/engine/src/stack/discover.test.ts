import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stack } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../engine.js";
import { gitOk } from "../git/run.js";
import { fakeGitHub, ghTime, prNode, retargeted } from "../testing/fake-github.js";
import { StackRepo } from "../testing/stack-repo.js";

let remote: StackRepo;
let dataDir: string;
beforeEach(async () => {
  remote = await StackRepo.create();
  dataDir = await mkdtemp(join(tmpdir(), "strata-data-"));
});
afterEach(async () => {
  await remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

const shape = (stack: Stack) => ({
  root: stack.root,
  base: stack.base,
  nodes: stack.nodes.map((node) => [node.pr.number, node.parent, node.anchor]),
  links: stack.edges.map((edge) => [edge.child, edge.via, edge.link]),
  paths: stack.paths,
  issues: stack.issues.map((issue) => issue.kind),
});

describe("engine.discoverStacks", () => {
  it("finds every stack in the repo from GitHub metadata and Strata's own clone", async () => {
    const m0 = await remote.tip("main");
    // A chain whose bottom was squash-merged; its child was retargeted, not rebased.
    const h1 = await remote.commit("b1", "main");
    const h2 = await remote.commit("b2", "b1");
    const h3 = await remote.commit("b3", "b2");
    const s1 = await remote.squashMerge("b1", "main");
    // A fork: two PRs on one parent.
    const h5 = await remote.commit("b5", "main");
    const h6 = await remote.commit("b6", "b5");
    const h7 = await remote.commit("b7", "b5");
    // A lone PR, and a fork-repo PR whose branch name matches #5's.
    const h4 = await remote.commit("b4", "main");
    const h8 = await remote.commit("fork-b5", "main");
    const heads = { 1: h1, 2: h2, 3: h3, 4: h4, 5: h5, 6: h6, 7: h7, 8: h8 };
    for (const [n, oid] of Object.entries(heads)) await remote.holdPr(Number(n), oid);
    await remote.deleteBranch("b1");
    await remote.deleteBranch("fork-b5");

    const github = fakeGitHub("acme/app", [
      prNode(1, h1, {
        state: "MERGED",
        mergedAt: ghTime(30),
        closedAt: ghTime(30),
        updatedAt: ghTime(30),
        mergeCommit: { oid: s1 },
      }),
      prNode(2, h2, {
        updatedAt: ghTime(31),
        timelineItems: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [retargeted("b1", "main", 31)],
        },
      }),
      prNode(3, h3, { baseRefName: "b2" }),
      prNode(4, h4),
      prNode(5, h5),
      prNode(6, h6, { baseRefName: "b5" }),
      prNode(7, h7, { baseRefName: "b5" }),
      prNode(8, h8, { headRefName: "b5", isCrossRepository: true }),
    ]);
    const engine = createEngine({
      dataDir,
      githubPort: github,
      gitRemote: () => remote.dir,
      now: () => new Date(Date.UTC(2026, 9, 2)),
    });

    const stacks = await engine.discoverStacks("acme/app");

    expect(stacks.map(shape)).toEqual([
      {
        root: 1,
        base: m0,
        nodes: [
          [1, null, m0],
          [2, 1, h1],
          [3, 2, h2],
        ],
        links: [
          [2, "retarget", "intact"],
          [3, "base-ref", "intact"],
        ],
        paths: [[1, 2, 3]],
        issues: [],
      },
      {
        root: 5,
        // #5 branched after #1's squash landed.
        base: s1,
        nodes: [
          [5, null, s1],
          [6, 5, h5],
          [7, 5, h5],
        ],
        links: [
          [6, "base-ref", "intact"],
          [7, "base-ref", "intact"],
        ],
        paths: [
          [5, 6],
          [5, 7],
        ],
        issues: [],
      },
    ]);
    // One fetch brought in the stacked PRs' heads and nothing else.
    const pulls = await gitOk(join(dataDir, "repos/acme/app.git"), [
      "for-each-ref",
      "--format=%(refname)",
      "refs/pull",
    ]);
    expect(pulls.trim().split("\n")).toEqual([1, 2, 3, 5, 6, 7].map((n) => `refs/pull/${n}/head`));
  });

  it("needs a GitHub token or port", async () => {
    const engine = createEngine({ dataDir });
    await expect(engine.discoverStacks("acme/app")).rejects.toThrow(/GITHUB_TOKEN/);
  });
});

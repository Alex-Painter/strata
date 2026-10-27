import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Stack } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../engine.js";
import { gitOk } from "../git/run.js";
import { demoRepo } from "../testing/demo-repo.js";
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
    const { github, m0, s1, heads } = await demoRepo(remote);
    const { 1: h1, 2: h2, 5: h5 } = heads;
    const logged: string[] = [];
    const engine = createEngine({
      dataDir,
      githubPort: github,
      gitRemote: () => remote.dir,
      now: () => new Date(Date.UTC(2026, 9, 2)),
      log: (message) => logged.push(message),
    });

    const steps: string[] = [];
    const stacks = await engine.discoverStacks("acme/app", {
      onProgress: (step) => steps.push(step),
    });

    expect(steps).toEqual([
      "Cloning acme/app into Strata's cache (only the first time)",
      "Fetching acme/app's branches and 6 PR heads",
      "Finding stacks: 0 of 2 groups of linked PRs done",
      "Finding stacks: 1 of 2 groups of linked PRs done",
    ]);
    // A server's log keeps the clone and fetch, though a caller follows them too.
    expect(logged).toContain("Fetching acme/app's branches and 6 PR heads");
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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChangeInput } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "../engine.js";
import { NotImplementedError } from "../errors.js";
import { type DemoRepo, demoRepo } from "../testing/demo-repo.js";
import { StackRepo } from "../testing/stack-repo.js";

let remote: StackRepo;
let dataDir: string;
let demo: DemoRepo;
beforeEach(async () => {
  remote = await StackRepo.create();
  dataDir = await mkdtemp(join(tmpdir(), "strata-data-"));
  demo = await demoRepo(remote);
});
afterEach(async () => {
  await remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

const engine = () =>
  createEngine({
    dataDir,
    githubPort: demo.github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
  });

describe("engine.resolveChange for stacks", () => {
  it("takes the stack around a PR, from its bottom PR to the newest tip", async () => {
    const resolved = await engine().resolveChange(parseChangeInput("acme/app#2"));

    expect(resolved.stack?.selectedPath).toEqual([1, 2, 3]);
    expect(resolved.title).toBe("Add the forecast model");
    expect(resolved.revisions).toEqual({ base: demo.m0, head: demo.heads[3] });
    expect(resolved.hints.map((hint) => [hint.label, hint.base, hint.head])).toEqual([
      ["#1 Add the forecast model", demo.m0, demo.heads[1]],
      ["#2 Add the forecast service", demo.heads[1], demo.heads[2]],
      ["#3 Add the forecast route", demo.heads[2], demo.heads[3]],
    ]);
  });

  it("follows a branch, and picks a fork's path by its tip", async () => {
    const byBranch = await engine().resolveChange(parseChangeInput("acme/app:b5"));
    expect(byBranch.stack?.paths).toEqual([
      [5, 6],
      [5, 7],
    ]);
    // #7 is the newest tip.
    expect(byBranch.stack?.selectedPath).toEqual([5, 7]);

    const byLeaf = await engine().resolveChange({
      kind: "stack-of",
      repo: { kind: "github", owner: "acme", name: "app" },
      seed: { pr: 5, leaf: 6 },
    });
    expect(byLeaf.stack?.selectedPath).toEqual([5, 6]);
  });

  it("checks that an explicit list is a real chain", async () => {
    const chain = await engine().resolveChange(parseChangeInput("acme/app#1,2,3"));
    expect(chain.stack?.selectedPath).toEqual([1, 2, 3]);

    await expect(engine().resolveChange(parseChangeInput("acme/app#1,3"))).rejects.toThrow(
      "#1, #3 isn't a chain of branch links. The stack through #1 is #1 → #2 → #3.",
    );
  });

  it("treats a PR outside any stack as a stack of one", async () => {
    const lone = await engine().resolveChange(parseChangeInput("acme/app#4"));
    expect(lone.stack?.selectedPath).toEqual([4]);
    expect(lone.hints).toHaveLength(1);
  });

  it("leaves commit ranges for later", async () => {
    await expect(
      engine().resolveChange(parseChangeInput("acme/app@main...b4")),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe("engine.analyzeChange for stacks", () => {
  it("reports the stack and its diffs, and says what isn't computed yet", async () => {
    const steps: string[] = [];
    const report = await engine().analyzeChange(parseChangeInput("acme/app#3"), {
      onProgress: (step) => steps.push(step),
    });

    expect(report.schemaVersion).toBe(3);
    expect(report.stack?.selectedPath).toEqual([1, 2, 3]);
    expect(report.change.title).toBe("Add the forecast model");
    expect(report.change.files).toHaveLength(3);
    expect(report.parts.map((part) => part.pr)).toEqual([1, 2, 3]);
    expect(report.verdict).toBeUndefined();
    expect(report.notes).toEqual(["Layers and summaries aren't computed yet."]);
    expect(steps).toEqual(["Finding the stack", "Building the diffs"]);
  });

  it("lets callers share one repo's caches at the same time", async () => {
    const shared = engine();
    const results = await Promise.all([
      shared.discoverStacks("acme/app"),
      shared.analyzeChange(parseChangeInput("acme/app#2")),
      engine().resolveChange(parseChangeInput("acme/app#6")),
      shared.analyzeChange(parseChangeInput("acme/app:b7")),
    ]);
    expect(results).toHaveLength(4);
  });

  it("gives the same Change id from any PR on the path", async () => {
    const a = await engine().analyzeChange(parseChangeInput("acme/app#1"));
    const b = await engine().analyzeChange(parseChangeInput("acme/app#3"));
    expect(a.change.id).toBe(b.change.id);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChangeInputError, canonicalReport, parseChangeInput, stableStringify } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEngine } from "./engine.js";
import { type DemoRepo, demoRepo } from "./testing/demo-repo.js";
import { StackRepo } from "./testing/stack-repo.js";

let remote: StackRepo;
let dataDir: string;
let demo: DemoRepo;
beforeEach(async () => {
  remote = await StackRepo.create();
  dataDir = await mkdtemp(join(tmpdir(), "strata-range-"));
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

describe("ranges", () => {
  it("run from the merge base of base and head", async () => {
    // main has #1's squash commit, which b3 doesn't, so they meet where the chain branched.
    const resolved = await engine().resolveChange(parseChangeInput("acme/app@main...b3"));
    expect(resolved.revisions).toEqual({ base: demo.m0, head: demo.heads[3] });
    expect(resolved.title).toBe("main...b3");
    expect(resolved.hints).toEqual([
      { kind: "commit-range", label: "main...b3", base: demo.m0, head: demo.heads[3] },
    ]);
    expect(resolved.stack).toBeNull();
  });

  it("give the same whole-stack view as the stack over the same code", async () => {
    const steps: string[] = [];
    const range = await engine().analyzeChange(parseChangeInput("acme/app@main...b3"), {
      onProgress: (step) => steps.push(step),
    });
    expect(steps).toEqual([
      "Finding the range",
      "Cloning acme/app into Strata's cache (only the first time)",
      "Fetching acme/app's branches",
      "Building the diff",
    ]);
    expect(range.stack).toBeNull();
    expect(range.parts).toEqual([]);
    expect(range.change.files.map((file) => file.path)).toEqual([
      "b1-2.txt",
      "b2-3.txt",
      "b3-4.txt",
    ]);
    const stack = await engine().analyzeChange(parseChangeInput("acme/app#3"));
    expect(stableStringify(canonicalReport(range))).toBe(stableStringify(canonicalReport(stack)));
    expect(range.change.id).not.toBe(stack.change.id);
  });

  it("take commit ids", async () => {
    // A PR's head is in Strata's copy once its stack has been read.
    await engine().analyzeChange(parseChangeInput("acme/app#3"));
    const report = await engine().analyzeChange(
      parseChangeInput(`acme/app@${demo.m0}...${demo.heads[3]}`),
    );
    expect(report.change.revisions).toEqual({ base: demo.m0, head: demo.heads[3] });
    expect(report.change.files).toHaveLength(3);
  });

  it("say when Strata's copy has no such branch or commit", async () => {
    const missing = engine().resolveChange(parseChangeInput("acme/app@main...nope"));
    await expect(missing).rejects.toBeInstanceOf(ChangeInputError);
    await expect(missing).rejects.toThrow(
      "Strata's copy of acme/app has no nope. Use a branch, or a commit on one.",
    );
  });
});

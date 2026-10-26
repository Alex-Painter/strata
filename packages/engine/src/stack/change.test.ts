import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { parseChangeInput } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineConfig } from "../api.js";
import { createEngine } from "../engine.js";
import { NotImplementedError } from "../errors.js";
import { settingsPath } from "../settings.js";
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

const engine = (config: Partial<EngineConfig> = {}) =>
  createEngine({
    dataDir,
    githubPort: demo.github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
    ...config,
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
  it("reports the stack and its diffs, and says why there's no summary", async () => {
    const steps: string[] = [];
    const report = await engine().analyzeChange(parseChangeInput("acme/app#3"), {
      onProgress: (step) => steps.push(step),
    });

    expect(report.schemaVersion).toBe(6);
    expect(report.stack?.selectedPath).toEqual([1, 2, 3]);
    expect(report.change.title).toBe("Add the forecast model");
    expect(report.change.files).toHaveLength(3);
    expect(report.parts.map((part) => part.pr)).toEqual([1, 2, 3]);
    expect(report.verdict).toBeUndefined();
    expect(report.summary).toEqual([]);
    expect(report.guide.by).toBe("rule");
    expect(report.guide.sections.map((section) => [section.title, section.paths])).toEqual([
      ["Docs: top level", ["b1-2.txt", "b2-3.txt", "b3-4.txt"]],
    ]);
    expect(report.parts.map((part) => part.summary)).toEqual([[], [], []]);
    expect(report.notes).toEqual([
      "There's no summary, and the Guide shows Strata's own groups. To have Claude write them, " +
        "turn on sendCodeToAnthropic in settings/acme/app.json in Strata's data folder.",
    ]);
    expect(report.analysis.model).toBeUndefined();
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

describe("engine.analyzeChange summaries", () => {
  async function allowClaude() {
    const path = settingsPath(dataDir, "acme/app");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ sendCodeToAnthropic: true }));
  }

  /** A stand-in for the Anthropic client: one sentence about the first hunk of anything. */
  function fakeClaude() {
    const bodies: Array<{ system: string }> = [];
    const client = {
      messages: {
        create: async (body: { system: string }) => {
          bodies.push(body);
          const sentence = [{ text: "Adds a note.", hunks: ["h1"] }];
          const answer = body.system.includes("one pull request")
            ? { summary: sentence }
            : { summary: sentence, sections: [{ title: "Notes", groups: ["g1"], about: [] }] };
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify(answer), citations: null }],
          };
        },
      },
    } as unknown as Anthropic;
    return { client, bodies };
  }

  it("says the step was skipped when the repo allows Claude but there's no key", async () => {
    await allowClaude();
    const steps: string[] = [];
    const report = await engine().analyzeChange(parseChangeInput("acme/app#3"), {
      onProgress: (step) => steps.push(step),
    });
    expect(report.summary).toEqual([]);
    expect(report.guide.by).toBe("rule");
    expect(report.notes).toEqual([
      "There's no summary, and the Guide shows Strata's own groups: this repo lets Claude " +
        "write them, but Strata has no Anthropic API key.",
    ]);
    expect(steps).not.toContain("Writing the summaries");
  });

  it("never asks Claude about a repo that doesn't allow it, even with a key", async () => {
    const { client, bodies } = fakeClaude();
    const report = await engine({ anthropicClient: client }).analyzeChange(
      parseChangeInput("acme/app#3"),
    );
    expect(bodies).toEqual([]);
    expect(report.summary).toEqual([]);
  });

  it("writes the summaries when the repo allows it, and answers again from the cache", async () => {
    await allowClaude();
    const { client, bodies } = fakeClaude();
    const steps: string[] = [];
    const report = await engine({ anthropicClient: client, model: "claude-test" }).analyzeChange(
      parseChangeInput("acme/app#3"),
      { onProgress: (step) => steps.push(step) },
    );
    expect(steps).toEqual(["Finding the stack", "Building the diffs", "Writing the summaries"]);
    expect(bodies).toHaveLength(4);
    expect(report.summary.map((claim) => claim.text)).toEqual(["Adds a note."]);
    expect(report.summary[0]?.evidence[0]?.anchor.source).toEqual({
      kind: "hunk",
      hunkId: report.change.hunks[0]?.id,
    });
    expect(report.guide).toMatchObject({ by: "llm", sections: [{ title: "Notes" }] });
    for (const part of report.parts) {
      expect(part.summary[0]?.evidence[0]?.anchor.source, `#${part.pr}`).toEqual({
        kind: "pr-hunk",
        pr: part.pr,
        hunkId: part.hunks[0]?.id,
      });
    }
    expect(report.notes).toEqual([]);
    expect(report.analysis.model).toBe("claude-test");
    expect(await readdir(join(dataDir, "llm-cache", "summaries"))).toHaveLength(4);

    const again = await engine({ anthropicClient: client, model: "claude-test" }).analyzeChange(
      parseChangeInput("acme/app#3"),
    );
    expect(bodies).toHaveLength(4);
    expect(again.summary).toEqual(report.summary);
  });
});

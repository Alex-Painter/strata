import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import {
  type ChangeReport,
  canonicalReport,
  type FileChange,
  parseChangeInput,
  stableStringify,
} from "@strata/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngine } from "./engine.js";
import { treeOf } from "./git/diff.js";
import { gitOk } from "./git/run.js";
import type { LayerJudge, LayerRequest } from "./layers/judge.js";
import { settingsPath } from "./settings.js";
import { type FeatureShape, featureShape, type ShapeRepo } from "./testing/feature-shapes.js";

/**
 * The shape-invariance benchmark (SPEC.md, "Benchmarks", 1): one feature built
 * six ways (see testing/feature-shapes.ts) must give the same whole-stack
 * view, and so must the same code given as a plain range with no PRs at all,
 * while "How it arrived" shows each split as it is. The repo lets
 * Claude sort files no rule matched and write the summaries, through fakes
 * that record what they're asked, so the questions are held to the same
 * standard.
 */
const SHAPES: FeatureShape[] = ["one-pr", "stack", "squash-merged", "restacked", "fork", "landed"];

interface Analysed {
  shape: ShapeRepo;
  report: ChangeReport;
  gitDir: string;
  asked: LayerRequest[];
  /** Every request sent to the fake Anthropic client. */
  bodies: Array<{ system: string; messages: Array<{ content: string }> }>;
}

/** Answers the summary questions with sentences citing the first hunks, and records them. */
function fakeClaude() {
  const bodies: Analysed["bodies"] = [];
  const client = {
    messages: {
      create: async (body: Analysed["bodies"][number]) => {
        bodies.push(body);
        const summary = [
          { text: "Accounts get forecasts.", hunks: ["h1", "h2"] },
          { text: "Cites nothing real.", hunks: ["h99"] },
        ];
        const answer = body.system.includes("one pull request")
          ? { summary }
          : {
              summary,
              sections: [
                {
                  title: "Forecasts",
                  groups: ["g3", "g1"],
                  about: [{ text: "The service and its model.", hunks: ["h3"] }],
                },
              ],
            };
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(answer), citations: null }],
        };
      },
    },
  } as unknown as Anthropic;
  return { client, bodies };
}

const isWhole = (body: Analysed["bodies"][number]) => !body.system.includes("one pull request");

const analysed = new Map<FeatureShape, Analysed>();
/** The stack shape's code given as a plain range, with no PRs at all. */
let range: Omit<Analysed, "shape">;
let dataDir: string;

/** Analyses `input` in its own data folder, with fakes standing in for Claude. */
async function analyse(shape: ShapeRepo, folder: string, input: string) {
  const settings = settingsPath(join(dataDir, folder), "acme/app");
  await mkdir(dirname(settings), { recursive: true });
  await writeFile(settings, JSON.stringify({ sendCodeToAnthropic: true }));
  const asked: LayerRequest[] = [];
  const layerJudge: LayerJudge = async (request) => {
    asked.push(request);
    return request.files.map((file) => ({
      path: file.path,
      layer: "logic",
      reason: `Service code in ${file.path}`,
    }));
  };
  const { client, bodies } = fakeClaude();
  const engine = createEngine({
    dataDir: join(dataDir, folder),
    githubPort: shape.github,
    gitRemote: () => shape.remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
    layerJudge,
    anthropicClient: client,
  });
  const parsed = parseChangeInput(input);
  const report = await engine.analyzeChange(parsed);
  const { gitDir } = await engine.resolveChange(parsed);
  return { report, gitDir, asked, bodies };
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "strata-shapes-"));
  for (const name of SHAPES) {
    const shape = await featureShape(name);
    analysed.set(name, { shape, ...(await analyse(shape, name, `acme/app#${shape.tip}`)) });
  }
  range = await analyse(get("stack").shape, "range", "acme/app@main...b4");
}, 60_000);

afterAll(async () => {
  for (const { shape } of analysed.values()) await shape.remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

const get = (name: FeatureShape) => analysed.get(name) as Analysed;

async function patchId({ report, gitDir }: Analysed): Promise<string> {
  const out = await gitOk(gitDir, ["patch-id", "--stable"], undefined, report.raw.diff);
  return out.split(" ")[0] as string;
}

describe("shape invariance", () => {
  const same: FeatureShape[] = ["one-pr", "stack", "squash-merged", "restacked", "landed"];

  it("gives the same whole-stack diff however the feature was split", async () => {
    const one = get("one-pr");
    expect(one.report.change.files.map((file) => file.path)).toEqual([
      "app/models/account.py",
      "app/routers/forecasts.py",
      "app/routers/permissions.py",
      "app/services/forecasts.py",
      "docs/forecasts.md",
      "tests/test_forecasts.py",
      "uv.lock",
    ]);
    const ids = await Promise.all(same.map((name) => patchId(get(name))));
    expect(new Set(ids).size).toBe(1);
    for (const name of same) {
      expect(get(name).report.change.files, name).toEqual(one.report.change.files);
      expect(get(name).report.change.hunks, name).toEqual(one.report.change.hunks);
    }
  });

  it("sorts the whole stack into the same layers", () => {
    const layers = (name: FeatureShape) =>
      get(name).report.change.layers.map((group) => [
        group.layer,
        group.files.map((file) => file.path),
        group.meaningfulHunks,
        group.mechanicalHunks,
      ]);
    expect(layers("one-pr")).toEqual([
      ["data-model", ["app/models/account.py"], 1, 0],
      ["api", ["app/routers/forecasts.py", "app/routers/permissions.py"], 2, 0],
      ["logic", ["app/services/forecasts.py"], 1, 0],
      ["tests", ["tests/test_forecasts.py"], 1, 0],
      ["config", ["uv.lock"], 0, 1],
      ["docs", ["docs/forecasts.md"], 1, 0],
    ]);
    for (const name of same) expect(layers(name), name).toEqual(layers("one-pr"));
  });

  it("flags the same files to inspect however the feature was split", () => {
    const flagged = (files: FileChange[]) =>
      files
        .filter((file) => file.inspect.length > 0)
        .map((file) => [file.path, file.inspect.map((flag) => flag.rule)]);
    const expected = flagged(get("one-pr").report.change.files);
    expect(expected).toEqual([["app/routers/permissions.py", ["access"]]]);
    for (const name of [...same, "fork" as const]) {
      const { change, parts } = get(name).report;
      expect(flagged(change.files), name).toEqual(expected);
      // Each part's copy of a file gets the whole stack's flags.
      const byPath = new Map(change.files.map((file) => [file.path, file]));
      for (const file of parts.flatMap((part) => part.files)) {
        expect(file.inspect, `${name} ${file.path}`).toEqual(byPath.get(file.path)?.inspect);
      }
    }
  });

  it("asks Claude the same question however the feature was split", () => {
    const one = get("one-pr");
    expect(one.asked).toHaveLength(1);
    expect(one.asked[0]?.files.map((file) => file.path)).toEqual(["app/services/forecasts.py"]);
    for (const name of same) expect(get(name).asked, name).toEqual(one.asked);
    const services = (name: FeatureShape) =>
      get(name).report.change.files.find((file) => file.path === "app/services/forecasts.py");
    expect(services("one-pr")?.layer).toMatchObject({ by: "llm", layer: "logic" });
    // Each part's copy of the file gets the whole stack's answer.
    for (const name of same) {
      for (const part of get(name).report.parts) {
        const file = part.files.find((f) => f.path === "app/services/forecasts.py");
        if (file) expect(file.layer, `${name} #${part.pr}`).toEqual(services("one-pr")?.layer);
      }
    }
  });

  it("asks for the summary with the same bytes however the feature was split", () => {
    const whole = (name: FeatureShape) => get(name).bodies.filter(isWhole);
    expect(whole("one-pr")).toHaveLength(1);
    for (const name of [...same, "fork" as const]) {
      expect(JSON.stringify(whole(name)), name).toBe(JSON.stringify(whole("one-pr")));
    }
    // Nothing about how the work arrived: no PR numbers, titles, branches or commits.
    const text = JSON.stringify(whole("stack"));
    const stack = get("stack").report.stack;
    const leaks = [
      ...(stack?.nodes ?? []).flatMap((node) => [
        `#${node.pr.number}`,
        node.pr.title,
        node.pr.headRef,
        ...(node.pr.baseRef === stack?.trunk.name ? [] : [node.pr.baseRef]),
        node.pr.headOid,
        node.pr.headOid.slice(0, 7),
      ]),
      get("stack").report.change.title,
      get("stack").report.change.revisions?.base.slice(0, 7) ?? "",
      get("stack").report.change.revisions?.head.slice(0, 7) ?? "",
    ];
    for (const leak of leaks) expect(text, leak).not.toContain(leak);
  });

  it("writes the same summary and Guide however the feature was split", () => {
    const { summary, guide } = get("one-pr").report;
    expect(summary.map((claim) => [claim.text, claim.evidence.map((e) => e.label)])).toEqual([
      ["Accounts get forecasts.", ["app/models/account.py:4", "app/routers/forecasts.py:1"]],
    ]);
    expect(guide.by).toBe("llm");
    expect(guide.sections.map((section) => section.title)).toEqual([
      "Forecasts",
      "API: app/routers/",
      "Tests: tests/",
      "Config & infra: lockfiles",
      "Docs: docs/",
    ]);
    for (const name of same) {
      expect(get(name).report.summary, name).toEqual(summary);
      expect(get(name).report.guide, name).toEqual(guide);
    }
    // Each PR is summarised from its own diff, so those differ with the split: the
    // sentence cites h1 and h2, and #2's diff has only one hunk.
    expect(get("one-pr").report.parts.map((part) => part.summary.length)).toEqual([1]);
    expect(get("stack").report.parts.map((part) => part.summary.length)).toEqual([1, 0, 1, 1]);
  });

  it("gives identical canonical reports", () => {
    const expected = stableStringify(canonicalReport(get("one-pr").report));
    for (const name of same) {
      expect(stableStringify(canonicalReport(get(name).report)), name).toBe(expected);
    }
  });

  it("ends each split at a different commit with the same tree", async () => {
    const one = get("one-pr");
    const stack = get("stack");
    expect(one.report.change.revisions?.head).not.toBe(stack.report.change.revisions?.head);
    expect(await treeOf(one.gitDir, one.report.change.revisions?.head as string)).toBe(
      await treeOf(stack.gitDir, stack.report.change.revisions?.head as string),
    );
  });

  it("keeps the split in the hints and parts, where it belongs", () => {
    expect(get("one-pr").report.change.hints).toHaveLength(1);
    expect(get("stack").report.change.hints).toHaveLength(4);
    expect(get("stack").report.parts.map((part) => [part.pr, part.how])).toEqual([
      [1, "direct"],
      [2, "direct"],
      [3, "direct"],
      [4, "direct"],
    ]);
    // #2 moved onto main past main's own new commit, so it's replayed onto #1.
    // #3 sits on #2's old head, which has the same code as the stack so far.
    expect(get("restacked").report.parts.map((part) => [part.pr, part.how])).toEqual([
      [1, "direct"],
      [2, "replayed"],
      [3, "direct"],
      [4, "direct"],
    ]);
    // Merged all at once, each PR still starts at the head below it.
    expect(get("landed").report.parts.map((part) => [part.pr, part.how])).toEqual([
      [1, "direct"],
      [2, "direct"],
      [3, "direct"],
      [4, "direct"],
    ]);
    // #4 fixes #2's service, so its part changes a file #2 added.
    const fix = get("stack").report.parts[3];
    expect(fix?.files.map((file) => [file.path, file.status])).toEqual([
      ["app/services/forecasts.py", "modified"],
      ["docs/forecasts.md", "modified"],
    ]);
  });

  it("never lets main's own new commits into the whole-stack diff", () => {
    for (const name of ["squash-merged", "restacked", "landed"] as const) {
      const paths = get(name).report.change.files.map((file) => file.path);
      expect(paths, name).not.toContain("README.md");
    }
  });

  it("gives the same canonical report and questions as the same code given as a range", () => {
    const stack = get("stack");
    expect(range.report.stack).toBeNull();
    expect(range.report.parts).toEqual([]);
    expect(stableStringify(canonicalReport(range.report))).toBe(
      stableStringify(canonicalReport(stack.report)),
    );
    expect(range.asked).toEqual(stack.asked);
    expect(JSON.stringify(range.bodies)).toBe(JSON.stringify(stack.bodies.filter(isWhole)));
  });

  it("gives a fork two paths, and the Change for one of them", () => {
    const fork = get("fork").report;
    expect(fork.stack?.paths).toEqual([
      [1, 2, 3, 4],
      [1, 2, 5],
    ]);
    expect(fork.stack?.selectedPath).toEqual([1, 2, 3, 4]);
    expect(stableStringify(canonicalReport(fork))).toBe(
      stableStringify(canonicalReport(get("stack").report)),
    );
  });

  it.todo("PR descriptions never feed the intent ledger");
});

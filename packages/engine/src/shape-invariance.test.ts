import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type ChangeReport,
  canonicalReport,
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
 * five ways (see testing/feature-shapes.ts) must give the same whole-stack
 * view, while "How it arrived" shows each split as it is. The repo lets
 * Claude sort files no rule matched, through a fake that records what it's
 * asked, so the questions are held to the same standard.
 */
const SHAPES: FeatureShape[] = ["one-pr", "stack", "squash-merged", "restacked", "fork"];

interface Analysed {
  shape: ShapeRepo;
  report: ChangeReport;
  gitDir: string;
  asked: LayerRequest[];
}

const analysed = new Map<FeatureShape, Analysed>();
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "strata-shapes-"));
  for (const name of SHAPES) {
    const shape = await featureShape(name);
    const settings = settingsPath(join(dataDir, name), "acme/app");
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
    const engine = createEngine({
      dataDir: join(dataDir, name),
      githubPort: shape.github,
      gitRemote: () => shape.remote.dir,
      now: () => new Date(Date.UTC(2026, 9, 2)),
      layerJudge,
    });
    const input = parseChangeInput(`acme/app#${shape.tip}`);
    const report = await engine.analyzeChange(input);
    const { gitDir } = await engine.resolveChange(input);
    analysed.set(name, { shape, report, gitDir, asked });
  }
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
  const same: FeatureShape[] = ["one-pr", "stack", "squash-merged", "restacked"];

  it("gives the same whole-stack diff however the feature was split", async () => {
    const one = get("one-pr");
    expect(one.report.change.files.map((file) => file.path)).toEqual([
      "app/models/account.py",
      "app/routers/forecasts.py",
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
      ["api", ["app/routers/forecasts.py"], 1, 0],
      ["logic", ["app/services/forecasts.py"], 1, 0],
      ["tests", ["tests/test_forecasts.py"], 1, 0],
      ["config", ["uv.lock"], 0, 1],
      ["docs", ["docs/forecasts.md"], 1, 0],
    ]);
    for (const name of same) expect(layers(name), name).toEqual(layers("one-pr"));
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
    // #4 fixes #2's service, so its part changes a file #2 added.
    const fix = get("stack").report.parts[3];
    expect(fix?.files.map((file) => [file.path, file.status])).toEqual([
      ["app/services/forecasts.py", "modified"],
      ["docs/forecasts.md", "modified"],
    ]);
  });

  it("never lets main's own new commits into the whole-stack diff", () => {
    for (const name of ["squash-merged", "restacked"] as const) {
      const paths = get(name).report.change.files.map((file) => file.path);
      expect(paths, name).not.toContain("README.md");
    }
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

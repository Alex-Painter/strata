import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ChangeReport, layerMatrix, parseChangeInput } from "@strata/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngine } from "../engine.js";
import { type FeatureShape, featureShape, type ShapeRepo } from "../testing/feature-shapes.js";

const SHAPES: FeatureShape[] = ["one-pr", "stack", "squash-merged", "restacked"];
const reports = new Map<FeatureShape, ChangeReport>();
const repos: ShapeRepo[] = [];
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "strata-provenance-"));
  for (const name of SHAPES) {
    const shape = await featureShape(name);
    repos.push(shape);
    const engine = createEngine({
      dataDir: join(dataDir, name),
      githubPort: shape.github,
      gitRemote: () => shape.remote.dir,
      now: () => new Date(Date.UTC(2026, 9, 2)),
    });
    reports.set(name, await engine.analyzeChange(parseChangeInput(`acme/app#${shape.tip}`)));
  }
}, 60_000);

afterAll(async () => {
  for (const shape of repos) await shape.remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

const get = (name: FeatureShape) => reports.get(name) as ChangeReport;

/** Each part's share of the whole stack, by path instead of hunk id. */
function shares(report: ChangeReport) {
  const paths = new Map(report.change.hunks.map((hunk) => [hunk.id, hunk.path]));
  return report.parts.map((part) => [
    part.pr,
    part.provenance?.inWhole.map((share) => [paths.get(share.hunkId), share.added, share.removed]),
  ]);
}

describe("provenance", () => {
  it("names the PR behind every line the whole stack adds or removes", () => {
    for (const name of ["stack", "squash-merged", "restacked"] as const) {
      expect(shares(get(name)), name).toEqual([
        [1, [["app/models/account.py", 1, 0]]],
        [2, [["app/services/forecasts.py", 4, 0]]],
        [
          3,
          [
            ["app/routers/forecasts.py", 8, 0],
            ["app/routers/permissions.py", 5, 0],
            ["tests/test_forecasts.py", 6, 0],
          ],
        ],
        [
          4,
          [
            ["app/services/forecasts.py", 1, 0],
            ["docs/forecasts.md", 2, 1],
          ],
        ],
      ]);
    }
  });

  it("marks #2's mistake as revised in #4, and nothing else", () => {
    for (const name of ["stack", "squash-merged", "restacked"] as const) {
      const report = get(name);
      const two = report.parts.find((part) => part.pr === 2);
      const service = two?.hunks.find((hunk) => hunk.path === "app/services/forecasts.py");
      expect(two?.provenance?.revisedLater, name).toEqual([
        { hunkId: service?.id, by: 4, lines: 1 },
      ]);
      for (const part of report.parts.filter((p) => p.pr !== 2)) {
        expect(part.provenance?.revisedLater, `${name} #${part.pr}`).toEqual([]);
      }
    }
  });

  it("gives a one-PR stack every line, revised by no one", () => {
    const report = get("one-pr");
    const [part] = report.parts;
    const traced = report.change.hunks.filter((hunk) => hunk.mechanical === null);
    expect(part?.provenance?.inWhole).toEqual(
      traced.map((hunk) => ({
        hunkId: hunk.id,
        added: hunk.lines.filter((line) => line.kind === "add").length,
        removed: hunk.lines.filter((line) => line.kind === "del").length,
      })),
    );
    expect(part?.provenance?.revisedLater).toEqual([]);
  });

  it("leaves mechanical files untraced", () => {
    const lock = get("stack").change.hunks.find((hunk) => hunk.path === "uv.lock");
    const shared = get("stack").parts.flatMap((part) => part.provenance?.inWhole ?? []);
    expect(shared.some((share) => share.hunkId === lock?.id)).toBe(false);
  });
});

describe("the layer by PR matrix", () => {
  const grid = (report: ChangeReport) =>
    layerMatrix(report).rows.map((row) => [
      row.layer,
      ...row.cells.map((c) =>
        c.files.length ? `${c.meaningful}/${c.mechanical}/${c.revised}` : "",
      ),
    ]);

  it("has a column per PR, then Net, with #2's revised line in its logic cell", () => {
    const matrix = layerMatrix(get("stack"));
    expect(matrix.prs).toEqual([1, 2, 3, 4]);
    // meaningful/mechanical/revised for #1, #2, #3, #4 and Net.
    expect(grid(get("stack"))).toEqual([
      ["data-model", "1/0/0", "", "", "", "1/0/0"],
      ["api", "", "", "13/0/0", "", "13/0/0"],
      ["logic", "", "5/0/1", "", "2/0/0", "5/0/0"],
      ["tests", "", "", "6/0/0", "", "6/0/0"],
      ["config", "0/2/0", "", "", "", "0/2/0"],
      ["docs", "", "", "", "3/0/0", "3/0/0"],
    ]);
    expect(matrix.max).toBe(13);
  });

  it("gives Net the whole stack's layers however the work was split", () => {
    const net = (report: ChangeReport) =>
      layerMatrix(report).rows.map((row) => [row.layer, row.cells.at(-1)]);
    const whole = get("one-pr").change.layers.map((group) => group.layer);
    expect(net(get("one-pr")).map(([layer]) => layer)).toEqual(whole);
    for (const name of SHAPES) expect(net(get(name)), name).toEqual(net(get("one-pr")));
  });

  it("gives a one-PR stack a column equal to Net", () => {
    for (const row of layerMatrix(get("one-pr")).rows) {
      const [pr, net] = row.cells;
      expect({ ...pr, pr: null, evidence: [] }, row.layer).toEqual({ ...net, evidence: [] });
    }
  });

  it("backs every non-empty cell with its hunks", () => {
    for (const name of SHAPES) {
      const report = get(name);
      for (const row of layerMatrix(report).rows) {
        for (const c of row.cells) {
          if (c.files.length === 0) {
            expect(c.evidence).toEqual([]);
            continue;
          }
          const hunks =
            c.pr === null ? report.change.hunks : report.parts.find((p) => p.pr === c.pr)?.hunks;
          expect(c.evidence.length, `${name} ${row.layer} ${c.pr}`).toBeGreaterThan(0);
          for (const item of c.evidence) {
            const source = item.anchor.source;
            const id = source.kind === "hunk" || source.kind === "pr-hunk" ? source.hunkId : null;
            expect(hunks?.some((hunk) => hunk.id === id)).toBe(true);
          }
        }
      }
    }
  });
});

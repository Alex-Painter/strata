import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseChangeInput } from "@strata/core";
import { createEngine } from "@strata/engine";
import { type DemoRepo, demoRepo, StackRepo } from "@strata/engine/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatReport } from "./report.js";

let remote: StackRepo;
let dataDir: string;
let demo: DemoRepo;
beforeAll(async () => {
  remote = await StackRepo.create();
  dataDir = await mkdtemp(join(tmpdir(), "strata-cli-"));
  demo = await demoRepo(remote);
});
afterAll(async () => {
  await remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

const analyze = (input: string) =>
  createEngine({
    dataDir,
    githubPort: demo.github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
  }).analyzeChange(parseChangeInput(input));

describe("formatReport", () => {
  it("prints the path, each PR's diff, the whole stack and the notes", async () => {
    expect(formatReport(await analyze("acme/app#3"))).toBe(
      [
        "acme/app: Add the forecast model",
        `#1 → #2 → #3 on main, from ${demo.m0.slice(0, 7)}`,
        "",
        "  #1  direct    1 file     +1 -0        Add the forecast model",
        "  #2  direct    1 file     +1 -0        Add the forecast service",
        "      GitHub's diff differs: #1 landed on main as a new commit, and #2 hasn't been " +
          "rebased since, so GitHub's diff of #2 repeats #1's changes.",
        "  #3  direct    1 file     +1 -0        Add the forecast route",
        "",
        "Whole stack: 3 files, +3 -0",
        "  Docs",
        "    A b1-2.txt  +1 -0",
        "    A b2-3.txt  +1 -0",
        "    A b3-4.txt  +1 -0",
        "",
        "  Layers by PR     #1   #2   #3  Net",
        "    Docs            1    1    1    3",
        "",
        "  - There's no summary, and the Guide shows Strata's own groups. To have Claude write " +
          "them, turn on sendCodeToAnthropic in settings/acme/app.json in Strata's data folder.",
        "",
      ].join("\n"),
    );
  });

  it("lists the stack's issues on the path only", async () => {
    const report = await analyze("acme/app#3");
    report.stack?.issues.push(
      { kind: "needs-restack", prs: [2], message: "On the path.", evidence: [] },
      { kind: "needs-restack", prs: [6], message: "Elsewhere.", evidence: [] },
    );
    const text = formatReport(report);
    expect(text).toContain("\n  ! On the path.\n  - There's no summary");
    expect(text).not.toContain("Elsewhere.");
  });

  it("prints each summary sentence with the hunks it rests on, and Claude's Guide", async () => {
    const report = await analyze("acme/app#3");
    const evidence = (path: string) => [
      { anchor: { source: { kind: "pr" as const, number: 1 } }, label: path },
    ];
    const claim = (text: string, ...paths: string[]) => ({
      text,
      confidence: "medium" as const,
      evidence: paths.flatMap(evidence),
    });
    report.summary = [claim("Adds three notes.", "b1-2.txt:1", "b3-4.txt:1")];
    const [one] = report.parts;
    if (one) one.summary = [claim("Adds the first note.", "b1-2.txt:1")];
    report.guide = {
      by: "llm",
      sections: [
        {
          id: "guide_1",
          title: "Notes",
          about: [claim("All three notes.", "b2-3.txt:1")],
          paths: ["a", "b", "c", "d", "e", "f"],
          hunkIds: [],
        },
        { id: "guide_2", title: "Docs: top level", about: [], paths: ["g"], hunkIds: [] },
      ],
    };
    const text = formatReport(report);
    expect(text).toContain(
      "  #1  direct    1 file     +1 -0        Add the forecast model\n" +
        "      Adds the first note. [b1-2.txt:1]\n",
    );
    expect(text).toContain(
      [
        "",
        "Summary",
        "  Adds three notes. [b1-2.txt:1, b3-4.txt:1]",
        "",
        "Guide",
        "  1. Notes: a, b, c, d, and 2 more",
        "     All three notes. [b2-3.txt:1]",
        "  2. Docs: top level: g",
        "",
        "Whole stack: 3 files, +3 -0",
      ].join("\n"),
    );
  });

  it("leaves Strata's own Guide out, since the layers below are its groups", async () => {
    const text = formatReport(await analyze("acme/app#3"));
    expect(text).not.toContain("Summary\n");
    expect(text).not.toContain("Guide\n");
  });

  it("says which layers Claude chose", async () => {
    const report = await analyze("acme/app#3");
    const [file] = report.change.files;
    if (file) {
      file.layer = { layer: "docs", by: "llm", reason: "A note for #1", confidence: "medium" };
    }
    expect(formatReport(report)).toContain("    A b1-2.txt  +1 -0  (Claude: A note for #1)\n");
  });

  it("marks revised and mechanical lines in the matrix", async () => {
    const report = await analyze("acme/app#3");
    const [one] = report.parts;
    const hunk = one?.hunks[0];
    if (one?.provenance && hunk) {
      one.provenance.revisedLater = [{ hunkId: hunk.id, by: 2, lines: 1 }];
    }
    const [file] = report.change.files;
    if (file) file.mechanical = { kind: "generated", reason: "Generated" };
    expect(formatReport(report)).toContain(
      "  Layers by PR       #1     #2     #3    Net\n    Docs           1 ↻1      1      1  2 +1m\n",
    );
  });
});

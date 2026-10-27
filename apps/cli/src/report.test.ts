import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FileChange, type LayerId, parseChangeInput } from "@strata/core";
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

  it("prints a range as its whole diff, with no PRs or matrix", async () => {
    expect(formatReport(await analyze("acme/app@main...b3"))).toBe(
      [
        "acme/app: main...b3",
        `${demo.m0.slice(0, 7)}...${demo.heads[3]?.slice(0, 7)}`,
        "",
        "Whole diff: 3 files, +3 -0",
        "  Docs",
        "    A b1-2.txt  +1 -0",
        "    A b2-3.txt  +1 -0",
        "    A b3-4.txt  +1 -0",
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

  it("prints the stack's notes before the report's", async () => {
    const report = await analyze("acme/app#3");
    report.stack?.notes.push("The whole-stack diff covers #1 only.");
    expect(formatReport(report)).toContain(
      "\n  - The whole-stack diff covers #1 only.\n  - There's no summary",
    );
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

  it("says which glob flagged a file to inspect", async () => {
    const report = await analyze("acme/app#3");
    const [file] = report.change.files;
    if (file) {
      file.inspect = [
        { rule: "access", title: "Access", reason: "Access: matches b1-*" },
        { rule: "deletion", title: "Deletion", reason: "Deletion: matches *-2.txt" },
      ];
      file.layer = { layer: "docs", by: "llm", reason: "A note for #1", confidence: "medium" };
    }
    expect(formatReport(report)).toContain(
      "    A b1-2.txt  +1 -0  (inspect: Access: matches b1-*; Deletion: matches *-2.txt)" +
        "  (Claude: A note for #1)\n",
    );
  });

  it("cuts a long file list, but never a file to inspect", async () => {
    const report = await analyze("acme/app#3");
    const [file] = report.change.files;
    if (!file) throw new Error("no file");
    const make = (path: string, flagged = false): FileChange => ({
      ...file,
      path,
      inspect: flagged ? [{ rule: "access", title: "Access", reason: `Access: in ${path}` }] : [],
    });
    // 40 Logic files fill the list; of the later layers, only Config has a flagged file.
    const logic = Array.from({ length: 41 }, (_, i) => make(`f${String(i).padStart(2, "0")}.py`));
    const tests = [make("test_a.py")];
    const config = [make("a.toml"), make("auth.toml", true)];
    report.change.files = [...logic, ...tests, ...config];
    const group = (layer: LayerId, files: FileChange[]) => ({
      layer,
      files: files.map((f) => ({ path: f.path, hunkIds: [] })),
      meaningfulHunks: 0,
      mechanicalHunks: 0,
    });
    report.change.layers = [group("logic", logic), group("tests", tests), group("config", config)];
    const text = formatReport(report);
    expect(text).toContain(
      "    A f39.py  +1 -0\n  Config & infra (inspect)\n    A auth.toml  +1 -0  (inspect: Access: in auth.toml)\n  … and 3 more\n",
    );
    expect(text).not.toContain("f40.py");
    expect(text).not.toContain("  Tests\n");
  });

  it("names a renamed file's old path", async () => {
    const report = await analyze("acme/app#3");
    const [file] = report.change.files;
    if (!file) throw new Error("no file");
    report.change.files = [{ ...file, status: "renamed", oldPath: "auth/b1-2.txt" }];
    expect(formatReport(report)).toContain("    R auth/b1-2.txt → b1-2.txt  +1 -0\n");
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

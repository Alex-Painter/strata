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
        "  - Summaries aren't computed yet.",
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
    expect(text).toContain("\n  ! On the path.\n  - Summaries");
    expect(text).not.toContain("Elsewhere.");
  });

  it("says which layers Claude chose", async () => {
    const report = await analyze("acme/app#3");
    const [file] = report.change.files;
    if (file) {
      file.layer = { layer: "docs", by: "llm", reason: "A note for #1", confidence: "medium" };
    }
    expect(formatReport(report)).toContain("    A b1-2.txt  +1 -0  (Claude: A note for #1)\n");
  });
});

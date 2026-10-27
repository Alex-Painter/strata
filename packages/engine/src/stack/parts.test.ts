import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalReport, parseChangeInput, stableStringify } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EngineConfig } from "../api.js";
import { createEngine } from "../engine.js";
import type { TimelineNode } from "../github/graphql.js";
import type { GitHubPort } from "../github/port.js";
import type { LayerJudge, LayerRequest } from "../layers/judge.js";
import { settingsPath } from "../settings.js";
import { demoRepo } from "../testing/demo-repo.js";
import { fakeGitHub, forcePushed, ghTime, prNode, retargeted } from "../testing/fake-github.js";
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

const analyze = (github: GitHubPort, input: string, config: Partial<EngineConfig> = {}) =>
  createEngine({
    dataDir,
    githubPort: github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
    ...config,
  }).analyzeChange(parseChangeInput(input));

async function writeSettings(settings: object) {
  const path = settingsPath(dataDir, "acme/app");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings));
}

const lines = (...values: string[]) => `${values.join("\n")}\n`;
const anchor = (report: Awaited<ReturnType<typeof analyze>>, pr: number) =>
  report.stack?.nodes.find((node) => node.pr.number === pr)?.anchor;

describe("each PR's diff", () => {
  it("never repeats a squash-merged parent's changes, and says why GitHub's does", async () => {
    const demo = await demoRepo(remote);
    const report = await analyze(demo.github, "acme/app#3");

    expect(report.parts.map((part) => [part.pr, part.how, part.files.map((f) => f.path)])).toEqual([
      [1, "direct", ["b1-2.txt"]],
      [2, "direct", ["b2-3.txt"]],
      [3, "direct", ["b3-4.txt"]],
    ]);
    expect(report.change.files.map((file) => file.path)).toEqual([
      "b1-2.txt",
      "b2-3.txt",
      "b3-4.txt",
    ]);
    expect(report.raw.diff).toContain("diff --git a/b1-2.txt b/b1-2.txt");

    const [one, two, three] = report.parts;
    // A merged PR is compared from where main was when it merged.
    expect(one?.github).toMatchObject({ base: demo.m0, same: true, reason: null });
    expect(two?.github).toMatchObject({
      base: demo.m0,
      same: false,
      onlyOnGitHub: ["b1-2.txt"],
      onlyHere: [],
      reason:
        "#1 landed on main as a new commit, and #2 hasn't been rebased since, " +
        "so GitHub's diff of #2 repeats #1's changes.",
    });
    // Strata's own commits aren't on GitHub, so the evidence names real ones.
    expect(two?.github?.evidence).toEqual([
      {
        anchor: { source: { kind: "commit", oid: demo.m0 } },
        label: "where GitHub's diff of #2 starts",
      },
      {
        anchor: { source: { kind: "commit", oid: demo.heads[1] } },
        label: "where Strata's starts",
      },
    ]);
    expect(three?.github).toMatchObject({ base: demo.heads[2], same: true, reason: null });
  });

  it("chains each part onto the one below", async () => {
    const demo = await demoRepo(remote);
    const report = await analyze(demo.github, "acme/app#3");
    const [one, two, three] = report.parts;
    expect(one?.from).toBe(demo.m0);
    expect(two?.from).toBe(one?.to);
    expect(three?.from).toBe(two?.to);
    expect(report.change.revisions).toEqual({ base: demo.m0, head: three?.to });
  });

  it("replays a PR that's behind its parent onto the parent's head now", async () => {
    await remote.commit("b9", "main");
    const h10 = await remote.commit("b10", "b9");
    const h9 = await remote.commit("b9");
    await remote.holdPr(9, h9);
    await remote.holdPr(10, h10);
    const github = fakeGitHub("acme/app", [prNode(9, h9), prNode(10, h10, { baseRefName: "b9" })]);
    const report = await analyze(github, "acme/app#10");

    expect(report.parts.map((part) => [part.pr, part.how, part.files.map((f) => f.path)])).toEqual([
      [9, "direct", ["b9-2.txt", "b9-4.txt"]],
      [10, "replayed", ["b10-3.txt"]],
    ]);
    // GitHub diffs #10 from where it left #9, and gets the same files.
    expect(report.parts[1]?.github).toMatchObject({ same: true, reason: null });
    expect(report.change.files.map((file) => file.path)).toEqual([
      "b10-3.txt",
      "b9-2.txt",
      "b9-4.txt",
    ]);
  });

  it("keeps each PR's own changes when the whole stack landed on main at once", async () => {
    // Each PR is squashed onto main in turn, while GitHub keeps the branch
    // below as the base of each PR above the bottom one.
    const m0 = await remote.tip("main");
    const heads = [
      await remote.write("b1", { "a.txt": lines("one") }, "main"),
      await remote.write("b2", { "b.txt": lines("two") }, "b1"),
      await remote.write("b3", { "c.txt": lines("three") }, "b2"),
    ];
    const squashes: string[] = [];
    for (const [i, oid] of heads.entries()) {
      squashes.push(await remote.squashMerge(`b${i + 1}`, "main"));
      await remote.holdPr(i + 1, oid);
    }
    for (const branch of ["b1", "b2", "b3"]) await remote.deleteBranch(branch);
    const github = fakeGitHub(
      "acme/app",
      heads.map((oid, i) =>
        prNode(i + 1, oid, {
          state: "MERGED",
          mergedAt: ghTime(30 + i),
          closedAt: ghTime(30 + i),
          baseRefName: i === 0 ? "main" : `b${i}`,
          baseRefOid: i === 0 ? m0 : heads[i - 1],
          mergeCommit: { oid: squashes[i] as string },
        }),
      ),
    );
    const report = await analyze(github, "acme/app#3");

    expect(report.stack?.edges.map((edge) => edge.link)).toEqual(["intact", "intact"]);
    expect(report.parts.map((part) => [part.pr, part.how, part.files.map((f) => f.path)])).toEqual([
      [1, "direct", ["a.txt"]],
      [2, "direct", ["b.txt"]],
      [3, "direct", ["c.txt"]],
    ]);
    expect(report.change.files.map((file) => file.path)).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(report.stack?.issues).toEqual([]);
    // GitHub diffed each one from the head below too.
    expect(report.parts.map((part) => part.github?.same)).toEqual([true, true, true]);
  });

  it("says why GitHub's diff of a merged PR differs, as of when it merged", async () => {
    // #1 is squashed onto main, then #2 is retargeted to main and squashed
    // without a rebase, so GitHub's diff of #2 still holds #1's changes.
    const m0 = await remote.tip("main");
    const h1 = await remote.write("b1", { "a.txt": lines("one") }, "main");
    const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
    const s1 = await remote.squashMerge("b1", "main");
    const s2 = await remote.land("b2", h1, "main");
    await remote.holdPr(1, h1);
    await remote.holdPr(2, h2);
    const merged = { state: "MERGED" as const, closedAt: ghTime(31) };
    const github = fakeGitHub("acme/app", [
      prNode(1, h1, { ...merged, mergedAt: ghTime(30), mergeCommit: { oid: s1 }, baseRefOid: m0 }),
      prNode(2, h2, {
        ...merged,
        mergedAt: ghTime(31),
        mergeCommit: { oid: s2 },
        baseRefOid: s1,
        timelineItems: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [retargeted("b1", "main", 30)],
        },
      }),
    ]);
    const report = await analyze(github, "acme/app#2");

    expect(report.parts.map((part) => [part.pr, part.how])).toEqual([
      [1, "direct"],
      [2, "direct"],
    ]);
    expect(report.parts[1]?.github).toMatchObject({
      base: m0,
      same: false,
      onlyOnGitHub: ["a.txt"],
      reason:
        "#1 landed on main as a new commit, and #2 wasn't rebased before it merged, " +
        "so GitHub's diff of #2 repeats #1's changes.",
    });
  });

  describe("says why GitHub's diff differs", () => {
    const merged = (minute: number, mergeCommit: string, baseRefOid: string) => ({
      state: "MERGED" as const,
      mergedAt: ghTime(minute),
      closedAt: ghTime(minute),
      mergeCommit: { oid: mergeCommit },
      baseRefOid,
    });
    const timeline = (...nodes: TimelineNode[]) => ({
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes,
    });

    it("for a PR merged into its parent's branch", async () => {
      const h1 = await remote.write("b1", { "a.txt": lines("one") }, "main");
      const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const mm = await remote.mergeCommit("b2", "b1");
      await remote.holdPr(1, mm);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [
        prNode(1, mm),
        prNode(2, h2, { baseRefName: "b1", ...merged(30, mm, h1) }),
      ]);
      const report = await analyze(github, "acme/app#1");

      expect(report.stack?.edges.map((e) => [e.child, e.link])).toEqual([
        [2, "merged-into-parent"],
      ]);
      expect(report.parts[1]?.github).toMatchObject({
        same: false,
        onlyOnGitHub: ["b.txt"],
        reason:
          "#2 was merged into b1, so its changes are in #1's diff here, " +
          "and GitHub's diff of #2 shows them as its own.",
      });
    });

    it("for a retargeted PR that was behind its parent when it merged", async () => {
      // #2 branched before #1's last commit, then both landed without a restack.
      const m0 = await remote.tip("main");
      const h1a = await remote.write("b1", { "a.txt": lines("one") }, "main");
      const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const h1 = await remote.write("b1", { "c.txt": lines("fix") });
      const s1 = await remote.squashMerge("b1", "main");
      const s2 = await remote.land("b2", h1a, "main");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, merged(30, s1, m0)),
        prNode(2, h2, {
          ...merged(31, s2, s1),
          timelineItems: timeline(retargeted("b1", "main", 30)),
        }),
      ]);
      const report = await analyze(github, "acme/app#2");

      expect(report.stack?.edges.map((e) => [e.child, e.link, e.via])).toEqual([
        [2, "behind", "retarget"],
      ]);
      expect(report.stack?.issues).toEqual([]);
      expect(report.parts[1]?.github).toMatchObject({
        base: m0,
        same: false,
        onlyOnGitHub: ["a.txt"],
        reason:
          "#1 landed on main as a new commit, and #2 wasn't rebased before it merged, " +
          "so GitHub's diff of #2 repeats #1's changes.",
      });
    });

    it("for a PR on a head its parent force-pushed away", async () => {
      const h1old = await remote.write("b1", { "a.txt": lines("one") }, "main");
      const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const h1 = await remote.amend("b1");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, { timelineItems: timeline(forcePushed(h1old, h1, 20)) }),
        prNode(2, h2, { baseRefName: "b1" }),
      ]);
      const report = await analyze(github, "acme/app#2");

      expect(report.stack?.edges.map((e) => [e.child, e.link])).toEqual([[2, "stale"]]);
      expect(report.parts[1]?.github).toMatchObject({
        same: false,
        onlyOnGitHub: ["a.txt"],
        reason:
          "#1 was force-pushed after #2 branched from it, so GitHub's diff of #2 " +
          "repeats the old #1 commits it sits on, and Strata's starts at #1's head now.",
      });
    });

    it("for a PR rebased onto main that still targets its parent's branch", async () => {
      // The stack landed at once, after #2 was rebased onto #1's landed commit.
      const m0 = await remote.tip("main");
      const h1 = await remote.write("b1", { "a.txt": lines("one") }, "main");
      await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const s1 = await remote.squashMerge("b1", "main");
      const h2 = await remote.rebase("b2", s1, h1);
      const s2 = await remote.land("b2", s1, "main");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, merged(30, s1, m0)),
        prNode(2, h2, { baseRefName: "b1", ...merged(31, s2, h1) }),
      ]);
      const report = await analyze(github, "acme/app#2");

      expect(report.stack?.edges.map((e) => [e.child, e.link, e.via])).toEqual([
        [2, "re-anchored", "base-ref"],
      ]);
      expect(report.parts[1]?.github).toMatchObject({
        base: m0,
        same: false,
        onlyOnGitHub: ["a.txt"],
        reason:
          "#2 didn't sit on #1's head but targeted b1, so GitHub's diff of #2 " +
          "also shows the commits it sits on that b1 doesn't have.",
      });
    });

    it("for a PR retargeted away from a parent that was closed", async () => {
      await remote.write("b1", { "a.txt": lines("one") }, "main");
      const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const h1 = await remote.tip("b1");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, { state: "CLOSED", closedAt: ghTime(30) }),
        prNode(2, h2, { timelineItems: timeline(retargeted("b1", "main", 30)) }),
      ]);
      const report = await analyze(github, "acme/app#2");

      expect(report.stack?.edges.map((e) => [e.child, e.link, e.via])).toEqual([
        [2, "intact", "retarget"],
      ]);
      expect(report.parts[1]?.github).toMatchObject({
        same: false,
        onlyOnGitHub: ["a.txt"],
        reason:
          "#2 was retargeted to main, which doesn't have all of #1's commits, " +
          "so GitHub's diff of #2 repeats the ones it sits on.",
      });
    });

    const ten = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    const withLine = (i: number, value: string) => ten.map((x, j) => (j === i ? value : x));

    it("for a retargeted PR behind a parent that landed with a merge commit", async () => {
      // The trunk holds #1's commits, so GitHub's diff of #2 repeats nothing.
      const m0 = await remote.tip("main");
      const h1a = await remote.write("b1", { "a.txt": lines(...ten) }, "main");
      const h2 = await remote.write("b2", { "a.txt": lines(...withLine(8, "nine")) }, "b1");
      const h1 = await remote.write("b1", { "a.txt": lines(...withLine(6, "seven")) });
      const mp = await remote.mergeCommit("b1", "main");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, merged(30, mp, m0)),
        prNode(2, h2, { timelineItems: timeline(retargeted("b1", "main", 30)) }),
      ]);
      const report = await analyze(github, "acme/app#2");

      expect(report.stack?.edges.map((e) => [e.child, e.link, e.via])).toEqual([
        [2, "behind", "retarget"],
      ]);
      expect(report.parts[1]?.github).toMatchObject({
        base: h1a,
        same: false,
        reason:
          "#2 is behind #1, so GitHub diffs it from where it left #1, " +
          "and Strata from #1's head now.",
      });
    });

    it("for a PR that moved off its open parent but still targets its branch", async () => {
      await remote.write("main", { "a.txt": lines(...ten) });
      const m0 = await remote.tip("main");
      const h1 = await remote.write("b1", { "a.txt": lines(...withLine(4, "five")) }, "main");
      await remote.write("b2", { "b.txt": lines("x") }, "b1");
      await remote.rebase("b2", m0, h1);
      const h2 = await remote.write("b2", { "a.txt": lines(...withLine(7, "eight")) });
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [prNode(1, h1), prNode(2, h2, { baseRefName: "b1" })]);
      const report = await analyze(github, "acme/app#2");

      expect(report.stack?.edges.map((e) => [e.child, e.link, e.via])).toEqual([
        [2, "re-anchored", "base-ref"],
      ]);
      expect(report.parts[1]?.github).toMatchObject({
        base: m0,
        same: false,
        reason:
          "#2 no longer sits on #1's head but still targets b1, so GitHub diffs it " +
          "from where it meets b1, and Strata from the stack below it.",
      });
    });

    it("for a PR merged into its parent's branch after the parent landed", async () => {
      // #2 landed and b2 moved on; #3 was then merged into b2.
      const m0 = await remote.tip("main");
      const h1 = await remote.write("b1", { "a.txt": lines(...ten) }, "main");
      const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const s1 = await remote.squashMerge("b1", "main");
      const s2 = await remote.land("b2", h1, "main");
      const later = await remote.write("b2", { "a.txt": lines(...withLine(6, "seven")) });
      const h3 = await remote.write(
        "b3",
        { "a.txt": lines(...withLine(6, "seven").map((x, j) => (j === 8 ? "nine" : x))) },
        "b2",
      );
      const mm = await remote.mergeCommit("b3", "b2");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      await remote.holdPr(3, h3);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, merged(30, s1, m0)),
        prNode(2, h2, {
          ...merged(31, s2, s1),
          timelineItems: timeline(retargeted("b1", "main", 30)),
        }),
        prNode(3, h3, { baseRefName: "b2", ...merged(40, mm, later) }),
      ]);
      const report = await analyze(github, "acme/app#3");

      expect(report.stack?.edges.map((e) => [e.child, e.link])).toEqual([
        [2, "intact"],
        [3, "merged-into-parent"],
      ]);
      expect(report.stack?.issues.map((issue) => [issue.kind, issue.prs])).toContainEqual([
        "base-already-merged",
        [3, 2],
      ]);
      expect(report.parts[2]?.github).toMatchObject({
        base: later,
        same: false,
        reason:
          "#3 was merged into b2 after #2 landed, so GitHub diffs it from b2 as it " +
          "was then, and Strata from the stack below it.",
      });
    });

    it("for a PR merged late into the branch of a parent that was replayed", async () => {
      // b2 didn't move after #2 landed, so the replay of #2 is the only difference.
      const m0 = await remote.tip("main");
      const h1a = await remote.write("b1", { "a.txt": lines(...ten) }, "main");
      const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const h3 = await remote.write("b3", { "a.txt": lines(...withLine(8, "nine")) }, "b2");
      const h1 = await remote.write("b1", { "a.txt": lines(...withLine(6, "seven")) });
      const s1 = await remote.squashMerge("b1", "main");
      const s2 = await remote.land("b2", h1a, "main");
      const mm = await remote.mergeCommit("b3", "b2");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      await remote.holdPr(3, h3);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, merged(30, s1, m0)),
        prNode(2, h2, {
          ...merged(31, s2, s1),
          timelineItems: timeline(retargeted("b1", "main", 30)),
        }),
        prNode(3, h3, { baseRefName: "b2", ...merged(40, mm, h2) }),
      ]);
      const report = await analyze(github, "acme/app#3");

      expect(report.parts.map((part) => [part.pr, part.how])).toEqual([
        [1, "direct"],
        [2, "replayed"],
        [3, "replayed"],
      ]);
      expect(report.parts[2]?.github).toMatchObject({
        base: h2,
        same: false,
        reason:
          "A PR below #3 was replayed onto newer code, so Strata diffs #3 from that, " +
          "and GitHub from b2.",
      });
    });

    it("for a PR merged into the branch of a parent that had closed", async () => {
      // #2's head never held #3's merge commit, so #2's diff doesn't have #3's changes.
      const h1a = await remote.write("b1", { "a.txt": lines(...ten) }, "main");
      const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const h3 = await remote.write("b3", { "a.txt": lines(...withLine(8, "nine")) }, "b2");
      const h1 = await remote.write("b1", { "a.txt": lines(...withLine(6, "seven")) });
      const mm = await remote.mergeCommit("b3", "b2");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      await remote.holdPr(3, h3);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1),
        prNode(2, h2, {
          baseRefName: "b1",
          state: "CLOSED",
          closedAt: ghTime(30),
          baseRefOid: h1a,
        }),
        prNode(3, h3, { baseRefName: "b2", ...merged(40, mm, h2) }),
      ]);
      const report = await analyze(github, "acme/app#3");

      expect(report.stack?.edges.map((e) => [e.child, e.link])).toEqual([
        [2, "behind"],
        [3, "merged-into-parent"],
      ]);
      expect(report.parts.map((part) => part.files.map((f) => f.path))).toEqual([
        ["a.txt"],
        ["b.txt"],
        ["a.txt"],
      ]);
      expect(report.parts[2]?.github).toMatchObject({
        same: false,
        reason:
          "A PR below #3 was replayed onto newer code, so Strata diffs #3 from that, " +
          "and GitHub from b2.",
      });
    });

    it("for a retargeted PR that took in main before its parent was squashed", async () => {
      // GitHub's base is the main #2 merged in, which never had #1's commits.
      const h1a = await remote.write("b1", { "a.txt": lines("one") }, "main");
      await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const m1 = await remote.write("main", { "m.txt": lines("main") });
      const h2 = await remote.mergeCommit("main", "b2");
      const h1 = await remote.write("b1", { "c.txt": lines("fix") });
      const s1 = await remote.squashMerge("b1", "main");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, merged(30, s1, m1)),
        prNode(2, h2, { timelineItems: timeline(retargeted("b1", "main", 30)) }),
      ]);
      const report = await analyze(github, "acme/app#2");

      expect(report.stack?.edges.map((e) => [e.child, e.link, e.via])).toEqual([
        [2, "behind", "retarget"],
      ]);
      expect(anchor(report, 2)).toBe(h1a);
      expect(report.parts[1]?.github).toMatchObject({
        base: m1,
        same: false,
        onlyOnGitHub: ["a.txt"],
        reason:
          "#1 landed on main as a new commit, and #2 hasn't been rebased since, " +
          "so GitHub's diff of #2 repeats #1's changes.",
      });
    });

    it("for a PR retargeted to a branch other than where its parent landed", async () => {
      // #1 landed on main with a merge commit, so main has its commits; develop doesn't.
      const m0 = await remote.tip("main");
      await remote.write("develop", { "d.txt": lines("dev") }, "main");
      const h1 = await remote.write("b1", { "a.txt": lines("one") }, "main");
      const h2 = await remote.write("b2", { "b.txt": lines("two") }, "b1");
      const mp = await remote.mergeCommit("b1", "main");
      await remote.holdPr(1, h1);
      await remote.holdPr(2, h2);
      const github = fakeGitHub("acme/app", [
        prNode(1, h1, merged(30, mp, m0)),
        prNode(2, h2, {
          baseRefName: "develop",
          timelineItems: timeline(retargeted("b1", "develop", 31)),
        }),
      ]);
      const report = await analyze(github, "acme/app#2");

      expect(report.stack?.edges.map((e) => [e.child, e.link, e.via])).toEqual([
        [2, "intact", "retarget"],
      ]);
      expect(report.parts[1]?.github).toMatchObject({
        same: false,
        onlyOnGitHub: ["a.txt"],
        reason:
          "#2 was retargeted to develop, which doesn't have all of #1's commits, " +
          "so GitHub's diff of #2 repeats the ones it sits on.",
      });
    });
  });

  it("stops the whole-stack diff at a replay conflict", async () => {
    const h1 = await remote.write("b1", { "a.txt": lines("one") }, "main");
    const h2 = await remote.write("b2", { "a.txt": lines("two") }, "b1");
    const h3 = await remote.write("b3", { "c.txt": lines("three") }, "b2");
    // #1 moves on and changes the same line #2 did.
    const h1Later = await remote.write("b1", { "a.txt": lines("uno") });
    for (const [n, oid] of [
      [1, h1Later],
      [2, h2],
      [3, h3],
    ] as const) {
      await remote.holdPr(n, oid);
    }
    const github = fakeGitHub("acme/app", [
      prNode(1, h1Later),
      prNode(2, h2, { baseRefName: "b1" }),
      prNode(3, h3, { baseRefName: "b2" }),
    ]);
    const report = await analyze(github, "acme/app#1");

    expect(report.parts.map((part) => [part.pr, part.how])).toEqual([
      [1, "direct"],
      [2, "apart"],
      [3, "apart"],
    ]);
    // Apart, each PR's diff runs from its anchor to its head.
    expect(report.parts[1]).toMatchObject({ from: h1, to: h2 });
    expect(report.parts[2]).toMatchObject({ from: h2, to: h3 });
    expect(report.change.files.map((file) => file.path)).toEqual(["a.txt"]);
    expect(report.change.revisions?.head).toBe(report.parts[0]?.to);

    const conflict = report.stack?.issues.find((issue) => issue.kind === "replay-conflict");
    expect(conflict).toMatchObject({
      prs: [2],
      message:
        "#2's changes conflict with the stack below it (a.txt), so the whole-stack diff stops at #1.",
    });
    expect(conflict?.evidence.slice(0, 2)).toEqual([
      { anchor: { source: { kind: "commit", oid: h1 } }, label: "where #2's changes start" },
      { anchor: { source: { kind: "commit", oid: h2 } }, label: "#2's head" },
    ]);
    // What the split left out is a note on the stack, not on the whole-stack view.
    expect(report.stack?.notes).toEqual([
      "The whole-stack diff covers #1 only. #2 and #3 aren't in it. The stack's issues say why.",
    ]);
    expect(report.notes).toEqual([
      "There's no summary, and the Guide shows Strata's own groups. To have Claude write them, " +
        "turn on sendCodeToAnthropic in settings/acme/app.json in Strata's data folder.",
    ]);

    // So the same code as a plain range gives the same canonical report.
    const { base, head } = report.change.revisions as { base: string; head: string };
    const range = await analyze(github, `acme/app@${base}...${head}`);
    expect(stableStringify(canonicalReport(range))).toBe(stableStringify(canonicalReport(report)));
  });

  it("sorts every part into layers with the repo's rules and .gitattributes", async () => {
    await remote.write("main", { ".gitattributes": "clients/** linguist-generated\n" });
    const h1 = await remote.write(
      "b1",
      {
        "billing/invoice.py": lines("TOTAL = 0"),
        "app/models/user.py": lines("class User: ..."),
        "clients/api.ts": lines("export {};"),
      },
      "main",
    );
    const h2 = await remote.write("b2", { "uv.lock": lines("version = 2") }, "b1");
    await remote.holdPr(1, h1);
    await remote.holdPr(2, h2);
    await writeSettings({
      layerRules: [{ id: "billing", layer: "data-model", paths: ["billing/**"], reason: "Money" }],
    });
    const github = fakeGitHub("acme/app", [prNode(1, h1), prNode(2, h2, { baseRefName: "b1" })]);
    const report = await analyze(github, "acme/app#2");

    expect(
      report.change.layers.map((group) => [group.layer, group.files.map((f) => f.path)]),
    ).toEqual([
      ["data-model", ["app/models/user.py", "billing/invoice.py"]],
      ["logic", ["clients/api.ts"]],
      ["config", ["uv.lock"]],
    ]);
    const byPath = new Map(report.change.files.map((file) => [file.path, file]));
    expect(byPath.get("billing/invoice.py")?.layer.reason).toBe("Money: matches billing/**");
    expect(byPath.get("clients/api.ts")?.mechanical?.reason).toBe(
      "Marked linguist-generated in .gitattributes",
    );
    expect(byPath.get("uv.lock")?.mechanical?.kind).toBe("lockfile");
    // Each part's files get the same layer as in the whole stack.
    for (const file of report.parts.flatMap((part) => part.files)) {
      expect(file.layer).toEqual(byPath.get(file.path)?.layer);
      expect(file.mechanical).toEqual(byPath.get(file.path)?.mechanical);
    }
  });

  it("asks Claude about the whole stack's unmatched files, only when the repo allows it", async () => {
    const h1 = await remote.write(
      "b1",
      {
        "app/billing.py": lines("class Invoice: ..."),
        "app/models/user.py": lines("class User: ..."),
      },
      "main",
    );
    const h2 = await remote.write(
      "b2",
      { "app/billing.py": lines("class Invoice:", "    total = 0") },
      "b1",
    );
    await remote.holdPr(1, h1);
    await remote.holdPr(2, h2);
    const github = fakeGitHub("acme/app", [prNode(1, h1), prNode(2, h2, { baseRefName: "b1" })]);
    const requests: LayerRequest[] = [];
    const layerJudge: LayerJudge = async (request) => {
      requests.push(request);
      return request.files.map((file) => ({
        path: file.path,
        layer: "data-model",
        reason: "Defines the invoice model",
      }));
    };

    const off = await analyze(github, "acme/app#2", { layerJudge });
    expect(requests).toEqual([]);
    expect(off.change.files.find((f) => f.path === "app/billing.py")?.layer.by).toBe("default");
    expect(off.notes).toContain(
      "Strata guessed the layer of 1 file. To place it, add layer rules or turn on " +
        "sendCodeToAnthropic in settings/acme/app.json in Strata's data folder.",
    );

    await writeSettings({ sendCodeToAnthropic: true });
    const on = await analyze(github, "acme/app#2", { layerJudge });
    // Only the whole-stack diff is asked about, so how it was split can't matter.
    expect(requests).toEqual([
      {
        known: [{ path: "app/models/user.py", layer: "data-model" }],
        files: [
          {
            path: "app/billing.py",
            status: "added",
            lines: ["+class Invoice:", "+    total = 0"],
          },
        ],
      },
    ]);
    const judged = {
      layer: "data-model",
      by: "llm",
      reason: "Defines the invoice model",
      confidence: "medium",
    };
    expect(on.change.files.find((f) => f.path === "app/billing.py")?.layer).toEqual(judged);
    for (const part of on.parts) {
      expect(part.files.find((f) => f.path === "app/billing.py")?.layer).toEqual(judged);
    }
    expect(on.change.layers.map((group) => group.layer)).toEqual(["data-model"]);
    expect(on.notes.some((note) => note.includes("guessed"))).toBe(false);
  });

  it("says when the repo allows Claude but there's no key", async () => {
    const h1 = await remote.write("b1", { "app/billing.py": lines("x = 1") }, "main");
    await remote.holdPr(1, h1);
    await writeSettings({ sendCodeToAnthropic: true });
    const report = await analyze(fakeGitHub("acme/app", [prNode(1, h1)]), "acme/app#1");
    expect(report.notes).toContain(
      "Strata guessed the layer of 1 file. This repo lets Claude sort it, but Strata has no Anthropic API key.",
    );
  });
});

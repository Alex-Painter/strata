import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeGitHub, forcePushed, ghTime, prNode, retargeted } from "../testing/fake-github.js";
import { loadPrIndex } from "./pr-index.js";

const DAY = 24 * 60;
const T0 = Date.UTC(2026, 9, 1);
/** A clock `minute` minutes after the fixtures' start. */
const clock = (minute: number) => () => new Date(T0 + minute * 60_000);

let dataDir: string;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "strata-index-"));
});
afterEach(() => rm(dataDir, { recursive: true, force: true }));

describe("loadPrIndex", () => {
  it("reads every PR updated inside the window, in every state, across pages", async () => {
    const github = fakeGitHub(
      "acme/app",
      [
        prNode(1, "a".repeat(40), { state: "MERGED", mergedAt: ghTime(20), updatedAt: ghTime(20) }),
        prNode(2, "b".repeat(40), { baseRefName: "b1" }),
        prNode(3, "c".repeat(40), { state: "CLOSED", closedAt: ghTime(5), updatedAt: ghTime(5) }),
      ],
      { pageSize: 2 },
    );

    const index = await loadPrIndex("acme/app", { port: github, dataDir, now: clock(30) });

    expect(index.repo).toBe("acme/app");
    expect(index.defaultBranch).toBe("main");
    expect(index.prs.map((pr) => [pr.number, pr.state])).toEqual([
      [1, "merged"],
      [2, "open"],
      [3, "closed"],
    ]);
    expect(github.calls.filter((call) => call.query === "page")).toHaveLength(2);
  });

  it("stops paging at the edge of the window and drops PRs that fall out of it", async () => {
    const github = fakeGitHub(
      "acme/app",
      [prNode(1, "a".repeat(40)), prNode(2, "b".repeat(40), { updatedAt: ghTime(100 * DAY) })],
      { pageSize: 1 },
    );

    const index = await loadPrIndex("acme/app", { port: github, dataDir, now: clock(100 * DAY) });

    expect(index.prs.map((pr) => pr.number)).toEqual([2]);
    expect(github.calls).toHaveLength(2);
  });

  it("refreshes from its cache, asking only for PRs updated since the last fetch", async () => {
    const github = fakeGitHub("acme/app", [prNode(1, "a".repeat(40)), prNode(2, "b".repeat(40))], {
      pageSize: 1,
    });
    await loadPrIndex("acme/app", { port: github, dataDir, now: clock(60) });
    const cached = JSON.parse(await readFile(join(dataDir, "github/acme/app.prs.json"), "utf8"));
    expect(cached.prs).toHaveLength(2);

    github.calls.length = 0;
    github.prs = [
      ...github.prs,
      prNode(3, "c".repeat(40), { baseRefName: "b2", updatedAt: ghTime(90) }),
    ];
    const index = await loadPrIndex("acme/app", { port: github, dataDir, now: clock(120) });

    expect(index.prs.map((pr) => pr.number)).toEqual([1, 2, 3]);
    // One page holds #3 and the next reaches PRs older than the last fetch.
    expect(github.calls).toHaveLength(2);
  });

  it("pages through a PR's events when one page isn't enough", async () => {
    const events = Array.from({ length: 120 }, (_, i) =>
      forcePushed(`${i}`.padStart(40, "0"), `${i + 1}`.padStart(40, "0"), 10 + i),
    );
    const github = fakeGitHub(
      "acme/app",
      [
        prNode(2, "b".repeat(40), {
          timelineItems: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [retargeted("b1", "main", 9), ...events],
          },
        }),
      ],
      { timelinePageSize: 50 },
    );

    const [pr] = (await loadPrIndex("acme/app", { port: github, dataDir, now: clock(200) })).prs;

    expect(pr?.baseChanges).toEqual([{ from: "b1", to: "main", at: ghTime(9) }]);
    expect(pr?.forcePushes).toHaveLength(120);
    expect(github.calls.filter((call) => call.query === "timeline")).toHaveLength(1);
  });

  it("says when GitHub can't see the repo", async () => {
    const github = fakeGitHub("acme/app", []);
    await expect(
      loadPrIndex("acme/other", { port: github, dataDir, now: clock(0) }),
    ).rejects.toThrow(/no repo acme\/other/);
    await expect(loadPrIndex("not a repo", { port: github, dataDir })).rejects.toThrow(
      /owner\/name/,
    );
  });
});

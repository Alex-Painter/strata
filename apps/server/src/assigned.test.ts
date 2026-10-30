import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AssignedStatus, ChangeSummary } from "@strata/core/model";
import type { Engine } from "@strata/engine";
import { type DemoRepo, demoRepo, StackRepo } from "@strata/engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { AssignedSearch } from "./assigned.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { changes as changesTable, runs as runsTable } from "./db/schema.js";
import { engineFactory } from "./engines.js";
import { Jobs } from "./jobs.js";
import { RunQueue } from "./runs.js";

const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));
const USER = "usr_dev";

let remote: StackRepo;
let demo: DemoRepo;
let dataDir: string;
const closers: Array<() => Promise<void> | void> = [];
beforeEach(async () => {
  remote = await StackRepo.create();
  demo = await demoRepo(remote);
  demo.github.viewer = "alex";
  dataDir = await mkdtemp(path.join(os.tmpdir(), "strata-assigned-"));
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

function setup(options: { wrap?: (engine: Engine) => Engine } = {}) {
  const config = loadConfig({ NODE_ENV: "test", DEV_AUTH_BYPASS: "1", DATA_DIR: dataDir });
  const { db, close } = openDatabase(":memory:", migrations);
  const real = engineFactory(config, db, {
    githubPort: demo.github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
    log: () => {},
  });
  const { wrap } = options;
  const engineFor = wrap ? (userId: string) => wrap(real(userId)) : real;
  const runs = new RunQueue(db, engineFor);
  const assigned = new AssignedSearch(db, engineFor, runs, ["acme/app"]);
  closers.push(async () => {
    await runs.idle();
    close();
  });
  const app = createApp({
    config,
    db,
    oauth: null,
    engineFor,
    runs,
    assigned,
    jobs: new Jobs(60_000),
  });
  const list = async () => {
    const res = await app.request("/api/changes");
    return ((await res.json()) as ChangeSummary[]).sort((a, b) => a.input.localeCompare(b.input));
  };
  const runCount = () => db.select().from(runsTable).all().length;
  return { app, db, runs, assigned, list, runCount };
}

/** Each Change as its input, your PRs and whether it waits on you. */
const shape = (list: ChangeSummary[]) =>
  list.map((c) => [c.input, c.origin, c.yours.map((pr) => [pr.number, pr.active]), c.waiting]);

describe("the assignment search", () => {
  it("makes the same Change for a lone PR, one PR in a stack, or every PR in it", async () => {
    demo.github.requests = {
      4: { assignees: ["alex"] },
      // #2 and #3 are on one path, so they share its Change.
      2: { reviewers: ["alex"] },
      3: { teams: [{ slug: "acme/backend", members: ["alex"] }] },
      // #6 is one side of a fork.
      6: { assignees: ["alex"] },
    };
    const { assigned, list, runs, runCount } = setup();

    await assigned.search(USER);

    expect(shape(await list())).toEqual([
      [
        "acme/app#2",
        "assigned",
        [
          [2, true],
          [3, true],
        ],
        true,
      ],
      ["acme/app#4", "assigned", [[4, true]], true],
      ["acme/app#6", "assigned", [[6, true]], true],
    ]);
    const changes = await list();
    expect(changes[0]?.yours[1]?.reasons).toEqual([
      { kind: "review-requested", direct: false, teams: ["acme/backend"] },
    ]);
    // One run per Change, not per PR.
    expect(runCount()).toBe(3);
    await runs.idle();
    expect(assigned.status(USER)).toMatchObject({ running: false, errors: [] });
  });

  it("covers the whole stack when you're on one PR in it", async () => {
    // #3 is the top of #1-#2-#3; #5 is the bottom of a fork whose newest tip is #7.
    demo.github.requests = { 3: { assignees: ["alex"] }, 5: { assignees: ["alex"] } };
    const { assigned, db } = setup();
    await assigned.search(USER);
    const paths = db
      .select()
      .from(changesTable)
      .all()
      .map((row) => [row.rootPr, row.tipPr])
      .sort();
    expect(paths).toEqual([
      [1, 3],
      [5, 7],
    ]);
  });

  it("runs again only once a head moves", async () => {
    demo.github.requests = { 4: { assignees: ["alex"] } };
    const { assigned, runs, runCount } = setup();
    await assigned.search(USER);
    await runs.idle();
    await assigned.search(USER);
    expect(runCount()).toBe(1);

    const moved = await remote.commit("b4");
    await remote.holdPr(4, moved);
    const pr4 = demo.github.prs.find((pr) => pr.number === 4);
    Object.assign(pr4 ?? {}, { headRefOid: moved, updatedAt: "2026-10-01T23:59:00Z" });
    await assigned.search(USER);
    expect(runCount()).toBe(2);
  });

  it("makes and runs a Change for a PR you've reviewed, which doesn't wait on you even if assigned", async () => {
    demo.github.requests = {
      4: { reviewedBy: ["alex"] },
      6: { reviewedBy: ["alex"], assignees: ["alex"] },
    };
    const { assigned, list, runCount } = setup();
    await assigned.search(USER);
    expect(shape(await list())).toEqual([
      ["acme/app#4", "assigned", [[4, true]], false],
      ["acme/app#6", "assigned", [[6, true]], false],
    ]);
    expect((await list())[0]?.yours[0]?.reasons).toEqual([{ kind: "reviewed" }]);
    expect(runCount()).toBe(2);
  });

  it("keeps the stack's name when it searches again", async () => {
    demo.github.requests = { 4: { assignees: ["alex"] } };
    const { db, runs, assigned, list } = setup();
    await assigned.search(USER);
    await runs.idle();
    // A finished run gave the Change the name Claude wrote for the stack.
    db.update(changesTable).set({ title: "A name for the stack" }).run();
    await assigned.search(USER);
    expect((await list()).map((change) => change.title)).toEqual(["A name for the stack"]);
  });

  it("keeps a Change once GitHub stops listing its PR, no longer waiting", async () => {
    demo.github.requests = { 4: { assignees: ["alex"] } };
    const { assigned, list } = setup();
    await assigned.search(USER);
    demo.github.requests = {};
    await assigned.search(USER);
    expect(shape(await list())).toEqual([["acme/app#4", "assigned", [[4, false]], false]]);
  });

  it("joins a Change typed in by hand, which stays yours", async () => {
    demo.github.requests = { 3: { assignees: ["alex"] } };
    const { app, assigned, list, runs, runCount } = setup();
    const res = await app.request("/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "acme/app#2" }),
    });
    expect(res.status).toBe(201);
    await runs.idle();
    await assigned.search(USER);
    expect(shape(await list())).toEqual([["acme/app#2", "added", [[3, true]], true]]);
    // Nothing moved since the run it already had.
    expect(runCount()).toBe(1);
  });

  it("reports a PR it couldn't make a Change for, and carries on", async () => {
    demo.github.requests = { 4: { assignees: ["alex"] }, 6: { assignees: ["alex"] } };
    const { assigned, list } = setup({
      wrap: (engine) => ({
        ...engine,
        resolveChange: (input, options) =>
          input.kind === "stack-of" && "pr" in input.seed && input.seed.pr === 4
            ? Promise.reject(new Error("no luck"))
            : engine.resolveChange(input, options),
      }),
    });
    await assigned.search(USER);
    expect(shape(await list())).toEqual([["acme/app#6", "assigned", [[6, true]], true]]);
    expect(assigned.status(USER).errors).toEqual(["acme/app#4: no luck"]);
  });

  it("answers its status and starts a search on request", async () => {
    demo.github.requests = { 4: { assignees: ["alex"] } };
    const { app, assigned, list } = setup();
    const res = await app.request("/api/assigned/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(202);
    expect(((await res.json()) as AssignedStatus).repos).toEqual(["acme/app"]);
    await assigned.search(USER);
    const status = (await (await app.request("/api/assigned")).json()) as AssignedStatus;
    expect(status).toMatchObject({ running: false, errors: [] });
    expect(status.lastFinishedAt).not.toBeNull();
    expect((await list()).map((c) => c.input)).toEqual(["acme/app#4"]);
  });
});

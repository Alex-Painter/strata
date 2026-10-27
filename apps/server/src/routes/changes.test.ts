import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangeDetail, ChangeSummary, StacksResponse } from "@strata/core/model";
import type { Engine } from "@strata/engine";
import { type DemoRepo, demoRepo, StackRepo } from "@strata/engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { changes as changesTable, runs as runsTable } from "../db/schema.js";
import { engineFactory } from "../engines.js";
import { Jobs } from "../jobs.js";
import { RunQueue } from "../runs.js";

const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));

let remote: StackRepo;
let demo: DemoRepo;
let dataDir: string;
const closers: Array<() => Promise<void> | void> = [];
beforeEach(async () => {
  remote = await StackRepo.create();
  demo = await demoRepo(remote);
  dataDir = await mkdtemp(path.join(os.tmpdir(), "strata-server-"));
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

function setup(options: { jobs?: Jobs; wrap?: (engine: Engine) => Engine } = {}) {
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
    // A long wait, so only the tests about a slow first read see a 202.
    jobs: options.jobs ?? new Jobs(60_000),
  });
  const post = (url: string, body: unknown) =>
    app.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, db, runs, post };
}

describe("GET /api/repos/:owner/:name/stacks", () => {
  it("lists the repo's stacks, newest activity first", async () => {
    const { app } = setup();
    const res = await app.request("/api/repos/acme/app/stacks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as StacksResponse;
    expect(body.repo).toBe("acme/app");
    expect(body.stacks.map((s) => [s.root, s.paths, s.defaultPath])).toEqual([
      [
        5,
        [
          [5, 6],
          [5, 7],
        ],
        [5, 7],
      ],
      [1, [[1, 2, 3]], [1, 2, 3]],
    ]);
    expect(body.stacks[1]?.prs.map((pr) => [pr.number, pr.state, pr.parent, pr.link])).toEqual([
      [1, "merged", null, null],
      [2, "open", 1, "intact"],
      [3, "open", 2, "intact"],
    ]);
    const chain = body.stacks[1];
    expect(chain?.base).toBe(demo.m0);
    expect(chain?.prs[0]).toMatchObject({
      mergeCommitOid: demo.s1,
      headRef: "b1",
      baseRef: "main",
    });
    expect(chain?.prs[1]?.linkEvidence.map((e) => e.label)).toEqual([
      "#2 was retargeted from b1",
      "#1's head branch is b1",
      "#1's head, inside #2",
    ]);
  });

  it("says when GitHub can't see the repo", async () => {
    const { app } = setup();
    const res = await app.request("/api/repos/acme/other/stacks");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "GitHub has no repo acme/other, or the token can't see it.",
    });
  });
});

describe("a slow first read of a repo", () => {
  /** An engine whose reads wait for the test, after saying how far they've got. */
  function held() {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    const wrap = (engine: Engine): Engine => ({
      ...engine,
      async discoverStacks(repo, options) {
        options?.onProgress?.("Reading PRs from GitHub: 50 so far");
        await opened;
        return engine.discoverStacks(repo, options);
      },
      async resolveChange(input, options) {
        options?.onProgress?.("Reading PRs from GitHub: 50 so far");
        await opened;
        return engine.resolveChange(input, options);
      },
    });
    return { wrap, open };
  }

  /** Asks again, as the web app does, until the answer isn't a 202. */
  async function until(send: () => Promise<Response> | Response) {
    for (let i = 0; i < 500; i++) {
      const res = await send();
      if (res.status !== 202) return res;
    }
    throw new Error("Still pending.");
  }

  it("answers the stack list with 202 and the latest step, then the stacks", async () => {
    const { wrap, open } = held();
    const { app } = setup({ jobs: new Jobs(20), wrap });
    const first = await app.request("/api/repos/acme/app/stacks");
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({
      pending: true,
      progress: "Reading PRs from GitHub: 50 so far",
    });
    open();
    const done = await until(() => app.request("/api/repos/acme/app/stacks"));
    expect(done.status).toBe(200);
    expect(((await done.json()) as StacksResponse).stacks).toHaveLength(2);
  });

  it("answers a new Change with 202 and the latest step, then creates it once", async () => {
    const { wrap, open } = held();
    const { post, db } = setup({ jobs: new Jobs(20), wrap });
    const first = await post("/api/changes", { input: "acme/app#2" });
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ pending: true });
    open();
    const done = await until(() => post("/api/changes", { input: "acme/app#2" }));
    expect(done.status).toBe(201);
    expect(db.select().from(changesTable).all()).toHaveLength(1);
  });

  it("creates no Change for a client that gave up waiting", async () => {
    const { wrap, open } = held();
    const { app, db } = setup({ wrap });
    const controller = new AbortController();
    const answer = app.request("/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "acme/app#2" }),
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    open();
    expect((await answer).status).toBe(499);
    expect(db.select().from(changesTable).all()).toEqual([]);
    expect(db.select().from(runsTable).all()).toEqual([]);
  });
});

describe("Changes", () => {
  it("creates one Change per path and runs it", async () => {
    const { app, runs, post } = setup();

    const created = await post("/api/changes", { input: "acme/app#2" });
    expect(created.status).toBe(201);
    const { change } = (await created.json()) as ChangeDetail;
    expect(change).toMatchObject({ title: "Add the forecast model", repo: "acme/app" });
    expect(change.input).toBe("acme/app#2");

    await runs.idle();
    const detail = (await (await app.request(`/api/changes/${change.id}`)).json()) as ChangeDetail;
    expect(detail.run?.status).toBe("done");
    expect(detail.report?.stack?.selectedPath).toEqual([1, 2, 3]);
    // The whole-stack diff ends at Strata's own commit for the tip.
    expect(detail.report?.change.revisions).toEqual({
      base: demo.m0,
      head: detail.report?.parts[2]?.to,
    });
    expect(detail.report?.change.files.map((file) => file.path)).toEqual([
      "b1-2.txt",
      "b2-3.txt",
      "b3-4.txt",
    ]);

    // Another PR on the same path finds the same Change.
    const again = await post("/api/changes", { input: "https://github.com/acme/app/pull/3" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as ChangeDetail).change.id).toBe(change.id);
  });

  it("makes a separate Change for each path of a fork", async () => {
    const { app, runs, post } = setup();
    const newest = (await (
      await post("/api/changes", { input: "acme/app#5" })
    ).json()) as ChangeDetail;
    const other = (await (
      await post("/api/changes", { input: "acme/app#5", leaf: 6 })
    ).json()) as ChangeDetail;
    await runs.idle();

    expect(newest.change.id).not.toBe(other.change.id);
    const list = (await (await app.request("/api/changes")).json()) as ChangeSummary[];
    expect(list.map((c) => c.id).sort()).toEqual([newest.change.id, other.change.id].sort());
    const paths = await Promise.all(
      [newest, other].map(async ({ change }) => {
        const d = (await (await app.request(`/api/changes/${change.id}`)).json()) as ChangeDetail;
        return d.report?.stack?.selectedPath;
      }),
    );
    expect(paths).toEqual([
      [5, 7],
      [5, 6],
    ]);
  });

  it("runs a Change again on request", async () => {
    const { app, runs, post } = setup();
    const { change } = (await (
      await post("/api/changes", { input: "acme/app#4" })
    ).json()) as ChangeDetail;
    await runs.idle();
    const first = (await (await app.request(`/api/changes/${change.id}`)).json()) as ChangeDetail;

    const rerun = await post(`/api/changes/${change.id}/runs`, {});
    expect(rerun.status).toBe(202);
    await runs.idle();
    const second = (await (await app.request(`/api/changes/${change.id}`)).json()) as ChangeDetail;
    expect(second.run?.id).not.toBe(first.run?.id);
    expect(second.run?.status).toBe("done");
    expect(second.report?.stack?.selectedPath).toEqual([4]);
  });

  it("answers bad input with a reason", async () => {
    const { post } = setup();
    const cases: [unknown, number, RegExp][] = [
      [{ input: "not a pr" }, 400, /Can't read "not a pr"/],
      [{ input: "acme/app#1,3" }, 400, /isn't a chain of branch links/],
      [{ input: "acme/app#99" }, 400, /#99 isn't in the PR index/],
      [{ input: "acme/app#1,2", leaf: 3 }, 400, /leaf only applies/],
      [{ input: "acme/app@main...b4" }, 501, /Commit ranges/],
      [{ input: "acme/app#2", sources: [{ kind: "spec" }] }, 501, /Context sources/],
      [{ nope: 1 }, 400, /Expected/],
    ];
    for (const [body, status, message] of cases) {
      const res = await post("/api/changes", body);
      const { error } = (await res.json()) as { error: string };
      expect([res.status, error]).toEqual([status, expect.stringMatching(message)]);
    }
  });

  it("answers unknown Changes with 404", async () => {
    const { app, post } = setup();
    expect((await app.request("/api/changes/chg_nope")).status).toBe(404);
    expect((await post("/api/changes/chg_nope/runs", {})).status).toBe(404);
  });

  it("records a run that fails, with the reason", async () => {
    const { app, runs, post, db } = setup();
    const { change } = (await (
      await post("/api/changes", { input: "acme/app#4" })
    ).json()) as ChangeDetail;
    await runs.idle();
    // The PR's head is gone from GitHub's side, so the next run can't fetch it.
    await remote.remove();
    await post(`/api/changes/${change.id}/runs`, {});
    await runs.idle();

    const detail = (await (await app.request(`/api/changes/${change.id}`)).json()) as ChangeDetail;
    expect(detail.run?.status).toBe("failed");
    expect(detail.run?.error).toBeTruthy();
    // The last good report is still there.
    expect(detail.report?.stack?.selectedPath).toEqual([4]);
    expect(db.select().from(runsTable).all()).toHaveLength(2);
    remote = await StackRepo.create();
  });
});

describe("RunQueue", () => {
  it("fails runs a previous process left unfinished", () => {
    const { db } = setup();
    const at = new Date();
    db.insert(changesTable)
      .values({
        id: "chg_x",
        ownerId: "usr_dev",
        repo: "acme/app",
        rootPr: 4,
        tipPr: 4,
        input: "acme/app#4",
        title: "Fix a typo",
        createdAt: at,
        updatedAt: at,
      })
      .run();
    db.insert(runsTable)
      .values([
        { id: "run_a", changeId: "chg_x", status: "running", queuedAt: at },
        { id: "run_b", changeId: "chg_x", status: "queued", queuedAt: at },
        { id: "run_c", changeId: "chg_x", status: "done", queuedAt: at },
      ])
      .run();

    new RunQueue(db, () => {
      throw new Error("not used");
    });

    expect(
      db
        .select()
        .from(runsTable)
        .all()
        .map((run) => [run.id, run.status, run.error]),
    ).toEqual([
      ["run_a", "failed", "Strata restarted before this run finished."],
      ["run_b", "failed", "Strata restarted before this run finished."],
      ["run_c", "done", null],
    ]);
  });
});

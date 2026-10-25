import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangeDetail, ChangeSummary, StacksResponse } from "@strata/core/model";
import { type DemoRepo, demoRepo, StackRepo } from "@strata/engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { changes as changesTable, runs as runsTable } from "../db/schema.js";
import { engineFactory } from "../engines.js";
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

function setup() {
  const config = loadConfig({ NODE_ENV: "test", DEV_AUTH_BYPASS: "1", DATA_DIR: dataDir });
  const { db, close } = openDatabase(":memory:", migrations);
  const engineFor = engineFactory(config, db, {
    githubPort: demo.github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
    log: () => {},
  });
  const runs = new RunQueue(db, engineFor);
  closers.push(async () => {
    await runs.idle();
    close();
  });
  const app = createApp({ config, db, oauth: null, engineFor, runs });
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
    expect(detail.report?.change.revisions).toEqual({ base: demo.m0, head: demo.heads[3] });

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

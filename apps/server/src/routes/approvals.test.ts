import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApprovalsResponse, ApproveResponse, ChangeDetail } from "@strata/core/model";
import { type DemoRepo, demoRepo, StackRepo } from "@strata/engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { AssignedSearch } from "../assigned.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { changes, prReviews } from "../db/schema.js";
import { engineFactory } from "../engines.js";
import { Jobs } from "../jobs.js";
import { RunQueue } from "../runs.js";

const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));
const ORIGIN = "http://localhost:5173";

let remote: StackRepo;
let demo: DemoRepo;
let dataDir: string;
const closers: Array<() => Promise<void> | void> = [];
beforeEach(async () => {
  remote = await StackRepo.create();
  demo = await demoRepo(remote);
  dataDir = await mkdtemp(path.join(os.tmpdir(), "strata-approve-"));
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

/** The demo chain #1 (merged) → #2 → #3, analysed, as the fake GitHub's "reviewer". */
async function setup() {
  const config = loadConfig({ NODE_ENV: "test", DEV_AUTH_BYPASS: "1", DATA_DIR: dataDir });
  const { db, close } = openDatabase(":memory:", migrations);
  const engineFor = engineFactory(config, db, {
    githubPort: demo.github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
    log: () => {},
  });
  const runs = new RunQueue(db, engineFor);
  const assigned = new AssignedSearch(db, engineFor, runs, []);
  closers.push(async () => {
    await runs.idle();
    close();
  });
  const app = createApp({ config, db, oauth: null, engineFor, runs, assigned, jobs: new Jobs() });
  const created = await app.request("/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "acme/app#3" }),
  });
  const { change } = (await created.json()) as ChangeDetail;
  await runs.idle();
  const approve = (body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/changes/${change.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  const approvals = async () =>
    (await (await app.request(`/api/changes/${change.id}/approvals`)).json()) as ApprovalsResponse;
  const approveCalls = () => demo.github.calls.filter((call) => call.query === "approve");
  return { app, db, change, approve, approvals, approveCalls };
}

describe("GET /api/changes/:id/approvals", () => {
  it("says what Approve can do for each PR on the path", async () => {
    const { approvals } = await setup();
    const body = await approvals();
    expect(body.viewer).toBe("reviewer");
    expect(body.prs.map((pr) => [pr.number, pr.state.kind])).toEqual([
      [1, "closed"],
      [2, "can-approve"],
      [3, "can-approve"],
    ]);
    expect(body.prs[1]?.analysedHead).toBe(demo.heads[2]);
  });

  it("blocks a PR that has new commits since the run", async () => {
    const { approvals } = await setup();
    const pr3 = demo.github.prs.find((pr) => pr.number === 3);
    if (pr3) pr3.headRefOid = "f".repeat(40);
    const body = await approvals();
    expect(body.prs[2]?.state).toEqual({
      kind: "head-moved",
      analysed: demo.heads[3],
      live: "f".repeat(40),
    });
  });
});

describe("POST /api/changes/:id/approve", () => {
  it("approves one PR at the analysed head and records it", async () => {
    const { approve, approveCalls, db } = await setup();
    const res = await approve({ prs: [{ number: 2, headOid: demo.heads[2] }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApproveResponse;
    expect(body.results).toEqual([
      {
        number: 2,
        ok: true,
        url: "https://github.com/acme/app/pull/2#pullrequestreview-1",
        commitOid: demo.heads[2],
      },
    ]);
    expect(approveCalls()).toEqual([
      { query: "approve", variables: { id: "PR_2", commit: demo.heads[2] } },
    ]);
    expect(body.approvals.prs[1]?.state.kind).toBe("approved");
    expect(body.approvals.prs[2]?.state.kind).toBe("can-approve");
    expect(db.select().from(prReviews).all()).toMatchObject([
      { repo: "acme/app", pr: 2, login: "reviewer", commitOid: demo.heads[2] },
    ]);
    // The Changes list shows GitHub's new review status.
    const row = db.select().from(changes).get();
    expect(JSON.parse(row?.pathPrs ?? "[]")[1]).toMatchObject({ number: 2, review: "approved" });
  });

  it("approves the whole stack, one review per PR", async () => {
    const { approve, approveCalls } = await setup();
    const res = await approve({
      stack: true,
      prs: [
        { number: 2, headOid: demo.heads[2] },
        { number: 3, headOid: demo.heads[3] },
      ],
    });
    const body = (await res.json()) as ApproveResponse;
    expect(body.results.map((r) => [r.number, r.ok])).toEqual([
      [2, true],
      [3, true],
    ]);
    expect(approveCalls()).toHaveLength(2);
    expect(body.approvals.prs.map((pr) => pr.state.kind)).toEqual([
      "closed",
      "approved",
      "approved",
    ]);
  });

  it("sends nothing for a stack while a PR on the path has new commits", async () => {
    const { approve, approveCalls } = await setup();
    const pr3 = demo.github.prs.find((pr) => pr.number === 3);
    if (pr3) pr3.headRefOid = "f".repeat(40);
    const res = await approve({ stack: true, prs: [{ number: 2, headOid: demo.heads[2] }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "#3 has new commits. Run Strata again before you approve the stack.",
    });
    expect(approveCalls()).toEqual([]);
  });

  it("sends nothing when one PR of several cannot be approved", async () => {
    const { approve, approveCalls } = await setup();
    const pr3 = demo.github.prs.find((pr) => pr.number === 3);
    if (pr3) pr3.author = { login: "reviewer" };
    const res = await approve({
      prs: [
        { number: 2, headOid: demo.heads[2] },
        { number: 3, headOid: demo.heads[3] },
      ],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "#3 is your PR. GitHub does not permit you to approve it.",
    });
    expect(approveCalls()).toEqual([]);
  });

  it("refuses a head that is not the one in the report", async () => {
    const { approve, approveCalls } = await setup();
    const res = await approve({ prs: [{ number: 2, headOid: demo.heads[3] }] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "The page shows an earlier run of #2. Open the page again.",
    });
    expect(approveCalls()).toEqual([]);
  });

  it("refuses a PR outside the Change, and a closed PR", async () => {
    const { approve } = await setup();
    const outside = await approve({ prs: [{ number: 4, headOid: demo.heads[4] }] });
    expect(outside.status).toBe(400);
    expect(await outside.json()).toEqual({ error: "#4 is not in this Change." });
    const merged = await approve({ prs: [{ number: 1, headOid: demo.heads[1] }] });
    expect(merged.status).toBe(409);
    expect(await merged.json()).toEqual({ error: "#1 is merged." });
  });

  it("accepts an approval only from Strata's own page", async () => {
    const { approve, app, change, approveCalls } = await setup();
    const prs = [{ number: 2, headOid: demo.heads[2] }];
    expect((await approve({ prs }, { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await app.request(`/api/changes/${change.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prs }),
    });
    expect(noOrigin.status).toBe(403);
    expect((await approve({ prs }, { "content-type": "text/plain" })).status).toBe(403);
    expect(approveCalls()).toEqual([]);
  });

  it("reports GitHub's refusal and records nothing", async () => {
    const { approve, db } = await setup();
    demo.github.refuseApproval[2] = "Resource not accessible by integration";
    const res = await approve({ prs: [{ number: 2, headOid: demo.heads[2] }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApproveResponse;
    expect(body.results).toEqual([
      {
        number: 2,
        ok: false,
        error: "GitHub did not accept the approval of #2. Resource not accessible by integration",
      },
    ]);
    expect(body.approvals.prs[1]?.state.kind).toBe("can-approve");
    expect(db.select().from(prReviews).all()).toEqual([]);
  });

  it("is not found for another user's Change", async () => {
    const { app } = await setup();
    const res = await app.request("/api/changes/chg_nope/approvals");
    expect(res.status).toBe(404);
  });
});

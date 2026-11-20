import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangeDetail, ReviewComment, SubmitReviewResponse } from "@strata/core/model";
import { type DemoRepo, demoRepo, StackRepo } from "@strata/engine/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { AssignedSearch } from "../assigned.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { changes, prComments, prReviews } from "../db/schema.js";
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
  dataDir = await mkdtemp(path.join(os.tmpdir(), "strata-review-"));
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
  const review = (body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/changes/${change.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    });
  const comments = async () =>
    (await (await app.request(`/api/changes/${change.id}/comments`)).json()) as ReviewComment[];
  const sent = () => demo.github.calls.filter((call) => call.query === "submit-review");
  /** A pending comment, as Ask leaves it. */
  let n = 0;
  const draft = (values: Partial<typeof prComments.$inferInsert> = {}) => {
    n += 1;
    const row = {
      id: `cmt_${n}`,
      ownerId: db.select().from(changes).get()?.ownerId ?? "",
      changeId: change.id,
      pr: 2,
      path: null,
      line: null,
      side: "RIGHT" as const,
      body: `Comment ${n}`,
      messageId: null,
      commitOid: null,
      state: "pending" as const,
      url: null,
      createdAt: new Date(Date.UTC(2026, 9, 2, 0, n)),
      ...values,
    };
    db.insert(prComments).values(row).run();
    return row.id;
  };
  return { app, db, change, review, comments, sent, draft };
}

describe("pending comments", () => {
  it("lists, edits and removes pending comments, and keeps posted ones", async () => {
    const { app, comments, draft } = await setup();
    const one = draft();
    const two = draft({ state: "posted", url: "https://github.com/acme/app/pull/2#r1" });
    expect((await comments()).map((c) => [c.id, c.state])).toEqual([
      [one, "pending"],
      [two, "posted"],
    ]);
    const patch = (id: string, body: unknown) =>
      app.request(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await patch(one, { body: "  Better.  " })).status).toBe(200);
    expect((await comments())[0]?.body).toBe("Better.");
    expect((await patch(one, { body: " " })).status).toBe(400);
    expect((await patch(two, { body: "No." })).status).toBe(409);
    expect(
      (await app.request(`/api/comments/${one}`, { method: "DELETE", headers: { origin: ORIGIN } }))
        .status,
    ).toBe(204);
    expect(
      (await app.request(`/api/comments/${two}`, { method: "DELETE", headers: { origin: ORIGIN } }))
        .status,
    ).toBe(409);
    expect((await comments()).map((c) => c.id)).toEqual([two]);
  });
});

describe("POST /api/changes/:id/review", () => {
  it("sends one review with the summary, line comments and comments on the PR as a whole", async () => {
    const { db, review, comments, sent, draft } = await setup();
    const line = draft({ path: "src/a.ts", line: 3, commitOid: demo.heads[2], body: "Why?" });
    const general = draft({ body: "Please add a rollout note." });
    const other = draft({ pr: 3, body: "Not in this review." });
    const res = await review({
      pr: 2,
      headOid: demo.heads[2],
      event: "COMMENT",
      body: " Looks close. ",
      commentIds: [line, general],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SubmitReviewResponse;
    const url = "https://github.com/acme/app/pull/2#pullrequestreview-1";
    expect(body.url).toBe(url);
    expect(sent()).toEqual([
      {
        query: "submit-review",
        variables: {
          id: "PR_2",
          commit: demo.heads[2],
          event: "COMMENT",
          body: "Looks close.\n\nPlease add a rollout note.",
          threads: [{ path: "src/a.ts", line: 3, side: "RIGHT", body: "Why?" }],
        },
      },
    ]);
    expect(body.posted.map((c) => [c.id, c.state, c.url])).toEqual([
      [line, "posted", url],
      [general, "posted", url],
    ]);
    expect((await comments()).find((c) => c.id === other)?.state).toBe("pending");
    expect(db.select().from(prReviews).all()).toMatchObject([{ pr: 2, event: "COMMENT", url }]);
    // An approval from the review box marks the PR approved.
    const approved = await review({
      pr: 3,
      headOid: demo.heads[3],
      event: "APPROVE",
      body: "",
      commentIds: [],
    });
    expect(approved.status).toBe(200);
    const after = (await approved.json()) as SubmitReviewResponse;
    expect(after.approvals.prs[2]?.state.kind).toBe("approved");
  });

  it("refuses an empty review, a moved head, a stale comment and a request from another page", async () => {
    const { review, sent, draft } = await setup();
    const empty = await review({
      pr: 2,
      headOid: demo.heads[2],
      event: "REQUEST_CHANGES",
      body: "",
      commentIds: [],
    });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Write a summary or add a comment first." });

    const stale = draft({ path: "src/a.ts", line: 3, commitOid: "e".repeat(40) });
    const old = await review({
      pr: 2,
      headOid: demo.heads[2],
      event: "COMMENT",
      body: "",
      commentIds: [stale],
    });
    expect(old.status).toBe(409);

    const elsewhere = await review(
      { pr: 2, headOid: demo.heads[2], event: "COMMENT", body: "Hi", commentIds: [] },
      { origin: "https://evil.example" },
    );
    expect(elsewhere.status).toBe(403);

    const merged = await review({
      pr: 1,
      headOid: demo.heads[1],
      event: "APPROVE",
      body: "",
      commentIds: [],
    });
    expect(merged.status).toBe(409);

    const pr2 = demo.github.prs.find((pr) => pr.number === 2);
    if (pr2) pr2.headRefOid = "f".repeat(40);
    const moved = await review({
      pr: 2,
      headOid: demo.heads[2],
      event: "COMMENT",
      body: "Hi",
      commentIds: [],
    });
    expect(moved.status).toBe(409);
    expect(await moved.json()).toEqual({
      error: "New commits since the run. Run Strata again to review this PR.",
    });
    expect(sent()).toEqual([]);
  });
});

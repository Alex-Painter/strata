import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChangeDetail, ChatMessage, ChatStreamEvent, ChatThread } from "@strata/core/model";
import type { ChatRequest, Engine } from "@strata/engine";
import { settingsPath } from "@strata/engine";
import { type DemoRepo, demoRepo, StackRepo } from "@strata/engine/testing";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "../app.js";
import { AssignedSearch } from "../assigned.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { reports } from "../db/schema.js";
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

/** The real engine, with chat replaced by a scripted answer that cites the first hunk. */
function setup() {
  const config = loadConfig({
    NODE_ENV: "test",
    DEV_AUTH_BYPASS: "1",
    DATA_DIR: dataDir,
    ANTHROPIC_API_KEY: "sk-test",
  });
  const { db, close } = openDatabase(":memory:", migrations);
  const real = engineFactory(config, db, {
    githubPort: demo.github,
    gitRemote: () => remote.dir,
    now: () => new Date(Date.UTC(2026, 9, 2)),
    log: () => {},
  });
  const asked: ChatRequest[] = [];
  const engineFor = (userId: string): Engine => {
    const engine = real(userId);
    return {
      ...engine,
      async *chat(request) {
        asked.push(request);
        const hunk = request.report.change.hunks[0]?.id;
        yield { type: "status", text: "Claude reads a hunk" };
        yield { type: "text", text: `It adds a file [${hunk}].` };
        yield { type: "text", text: " See also [hunk_0000000000000000]." };
      },
    };
  };
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
    assigned: new AssignedSearch(db, engineFor, runs, []),
  });
  const post = (url: string, body: unknown) =>
    app.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, db, runs, post, asked };
}

async function allowClaude(allow = true) {
  const file = settingsPath(dataDir, "acme/app");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ sendCodeToAnthropic: allow }));
}

/** The events of a text/event-stream body. */
async function events(res: Response): Promise<ChatStreamEvent[]> {
  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as ChatStreamEvent);
}

it("keeps threads on a Change and streams answers with checked citations", async () => {
  await allowClaude();
  const { app, runs, post, asked } = setup();
  const created = (await (
    await post("/api/changes", { input: "acme/app#2" })
  ).json()) as ChangeDetail;
  await runs.idle();
  const id = created.change.id;

  const made = await post(`/api/changes/${id}/threads`, {});
  expect(made.status).toBe(201);
  const thread = (await made.json()) as ChatThread;
  expect(thread.title).toBe("");

  const anchor = { source: { kind: "pr", number: 2 } };
  const res = await post(`/api/threads/${thread.id}/messages`, {
    text: "What does #2 add?\nSecond line.",
    anchors: [anchor],
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const stream = await events(res);
  expect(stream.map((e) => e.type)).toEqual(["status", "delta", "delta", "done"]);
  const done = stream.at(-1) as Extract<ChatStreamEvent, { type: "done" }>;
  const hunk = asked[0]?.report.change.hunks[0]?.id;
  expect(done.message.text).toBe(`It adds a file [${hunk}]. See also.`);
  expect(asked[0]?.anchors).toEqual([anchor]);
  expect(asked[0]?.history).toEqual([]);

  const messages = (await (
    await app.request(`/api/threads/${thread.id}/messages`)
  ).json()) as ChatMessage[];
  expect(messages.map((m) => [m.role, m.text])).toEqual([
    ["user", "What does #2 add?\nSecond line."],
    ["assistant", done.message.text],
  ]);
  expect(messages[0]?.anchors).toEqual([anchor]);
  expect(messages[0]?.analysedAt).toBe(asked[0]?.report.analysis.startedAt);

  const threads = (await (await app.request(`/api/changes/${id}/threads`)).json()) as ChatThread[];
  expect(threads.map((t) => t.title)).toEqual(["What does #2 add?"]);

  // The next question carries the thread so far.
  await events(await post(`/api/threads/${thread.id}/messages`, { text: "And #3?", anchors: [] }));
  expect(asked[1]?.history.map((m) => m.role)).toEqual(["user", "assistant"]);
});

it("asks nothing when the repo does not allow Claude, or before a report exists", async () => {
  await allowClaude(false);
  const { db, runs, post, asked } = setup();
  const created = (await (
    await post("/api/changes", { input: "acme/app#2" })
  ).json()) as ChangeDetail;
  await runs.idle();
  const thread = (await (
    await post(`/api/changes/${created.change.id}/threads`, {})
  ).json()) as ChatThread;

  const off = await post(`/api/threads/${thread.id}/messages`, { text: "Hi", anchors: [] });
  expect(off.status).toBe(403);
  expect(await off.json()).toEqual({
    error: 'Turn on "Send the code in acme/app to Claude" in Settings to ask Claude.',
  });

  db.delete(reports).run();
  await allowClaude();
  const early = await post(`/api/threads/${thread.id}/messages`, { text: "Hi", anchors: [] });
  expect(early.status).toBe(409);

  expect((await post(`/api/threads/${thread.id}/messages`, { text: "  " })).status).toBe(400);
  expect((await post("/api/threads/thr_nope/messages", { text: "Hi" })).status).toBe(404);
  expect(asked).toHaveLength(0);
});

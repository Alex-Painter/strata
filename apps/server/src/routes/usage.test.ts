import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UsageResponse } from "@strata/core/model";
import type { Engine, UsageEntry } from "@strata/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { AssignedSearch } from "../assigned.js";
import { type Billing, createBilling } from "../billing.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { changes } from "../db/schema.js";
import { RunQueue } from "../runs.js";

const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));

let dataDir: string;
const closers: Array<() => void> = [];
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "strata-usage-"));
});
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  await rm(dataDir, { recursive: true, force: true });
});

const today = new Date().toISOString().slice(0, 10);
const line = (fields: Partial<UsageEntry>): UsageEntry => ({
  at: `${today}T08:00:00.000Z`,
  task: "pr-summary",
  model: "claude-haiku-5-5",
  cached: false,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.25,
  ...fields,
});

async function setup(entries: UsageEntry[], billing?: Billing) {
  await writeFile(
    path.join(dataDir, "llm-usage.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n"),
  );
  const config = loadConfig({ NODE_ENV: "test", DEV_AUTH_BYPASS: "1", DATA_DIR: dataDir });
  const { db, close } = openDatabase(":memory:", migrations);
  closers.push(close);
  const now = new Date();
  db.insert(changes)
    .values({
      id: "chg_1",
      ownerId: "usr_dev",
      repo: "acme/app",
      rootPr: 1,
      tipPr: 2,
      input: "acme/app#2",
      title: "Add billing",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const engineFor = () => ({}) as Engine;
  const runs = new RunQueue(db, engineFor);
  const assigned = new AssignedSearch(db, engineFor, runs, []);
  const app = createApp({
    config,
    db,
    oauth: null,
    engineFor,
    runs,
    assigned,
    ...(billing ? { billing } : {}),
  });
  return async (query = "") => app.request(`/api/usage${query}`);
}

describe("GET /api/usage", () => {
  it("groups the usage log of the period and names each Change", async () => {
    const get = await setup([
      line({ changeId: "chg_1", repo: "acme/app" }),
      line({ task: "chat", model: "claude-sonnet-5-5", costUsd: 1, changeId: "chg_gone" }),
      line({ cached: true, costUsd: 0 }),
      line({ at: "2020-01-01T00:00:00.000Z", costUsd: 50 }),
    ]);
    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as UsageResponse;
    expect(body.days).toBe(30);
    expect(body.total).toMatchObject({ requests: 2, cached: 1, costUsd: 1.25 });
    expect(body.byTask.map((r) => r.task)).toEqual(["chat", "pr-summary"]);
    expect(body.byDay.map((r) => r.day)).toEqual([today]);
    expect(body.byChange.map((r) => [r.changeId, r.title, r.repo])).toEqual([
      ["chg_gone", null, null],
      ["chg_1", "Add billing", "acme/app"],
      [null, null, null],
    ]);
    // No admin key: no billed amount and no error.
    expect(body.billed).toBeNull();
    expect(body.billedError).toBeNull();
  });

  it("refuses a period other than 7, 30 or 90 days", async () => {
    const get = await setup([]);
    const response = await get("?days=12");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Set days to 7, 30 or 90." });
  });

  it("adds the billed amount, or the reason that Strata cannot read it", async () => {
    let get = await setup([], async () => ({
      billed: { costUsd: 3.2, scope: "key" },
      error: null,
    }));
    expect(((await (await get("?days=7")).json()) as UsageResponse).billed).toEqual({
      costUsd: 3.2,
      scope: "key",
    });
    get = await setup([], async () => ({ billed: null, error: "Status 401." }));
    expect(((await (await get()).json()) as UsageResponse).billedError).toBe("Status 401.");
  });
});

describe("createBilling", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const now = () => new Date("2026-11-12T10:00:00Z");

  it("reads the cost of one API key, in cents, across pages and 31-day windows", async () => {
    const urls: URL[] = [];
    const billing = createBilling({
      key: "sk-ant-admin-test",
      apiKeyId: "apikey_1",
      now,
      fetch: async (input) => {
        const url = new URL(String(input));
        urls.push(url);
        if (url.searchParams.get("page") === null && urls.length === 1) {
          return json({
            data: [{ cost: { amount: "150.000000" } }],
            has_more: true,
            next_page: "p2",
          });
        }
        return json({ data: [{ cost: { amount: "25.5" } }], has_more: false });
      },
    });
    expect(await billing(90)).toEqual({
      billed: { costUsd: 1.5 + 0.255 * 3, scope: "key" },
      error: null,
    });
    expect(urls[0]?.pathname).toBe("/v1/organizations/analytics/cost");
    expect(urls[0]?.searchParams.getAll("api_key_ids[]")).toEqual(["apikey_1"]);
    expect(urls[1]?.searchParams.get("page")).toBe("p2");
    // 90 days is three windows: 31, 31 and 28 days.
    expect(
      urls.filter((u) => !u.searchParams.get("page")).map((u) => u.searchParams.get("starting_at")),
    ).toEqual(["2026-08-15T00:00:00.000Z", "2026-09-15T00:00:00.000Z", "2026-10-16T00:00:00.000Z"]);
    // A second request in ten minutes reads the cache.
    const before = urls.length;
    await billing(90);
    expect(urls.length).toBe(before);
  });

  it("reads the organization's cost report when the analytics API refuses", async () => {
    const billing = createBilling({
      key: "k",
      apiKeyId: "apikey_1",
      now,
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/analytics/cost"))
          return json({ error: { message: "No." } }, 403);
        return json({
          data: [{ results: [{ amount: "100" }, { amount: "20" }] }],
          has_more: false,
        });
      },
    });
    expect(await billing(7)).toEqual({
      billed: { costUsd: 1.2, scope: "organization" },
      error: null,
    });
  });

  it("says what went wrong for a bad key", async () => {
    const billing = createBilling({
      key: "bad",
      apiKeyId: null,
      now,
      fetch: async () => json({ error: { message: "invalid x-api-key" } }, 401),
    });
    expect(await billing(30)).toEqual({
      billed: null,
      error: "The Anthropic Admin API sent status 401. invalid x-api-key",
    });
  });
});

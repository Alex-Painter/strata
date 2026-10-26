import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangeInput } from "@strata/core";
import type { StacksResponse } from "@strata/core/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { engineFactory } from "../engines.js";
import { RunQueue } from "../runs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.join(here, "../../drizzle");

let child: ChildProcess;
let ready: { graphql: string; remote: string };
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "strata-fixture-"));
  child = spawn(process.execPath, ["--import", "tsx", path.join(here, "fixture-github.ts")], {
    cwd: path.join(here, "../.."),
    stdio: ["ignore", "pipe", "inherit"],
  });
  ready = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = /^READY (\S+) (\S+)$/m.exec(out);
      if (match) resolve({ graphql: match[1] as string, remote: match[2] as string });
    });
    child.on("exit", (code) => reject(new Error(`fixture GitHub exited with ${code}`)));
  });
}, 30_000);

afterAll(async () => {
  await stop(child);
  await rm(dataDir, { recursive: true, force: true });
});

async function stop(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise((resolve) => proc.once("exit", resolve));
  proc.kill("SIGTERM");
  await exited;
}

describe("the fixture GitHub", () => {
  it("serves the demo stacks to a dev server pointed at it", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DEV_AUTH_BYPASS: "1",
      DEV_GITHUB_TOKEN: "fixture",
      DEV_GITHUB_GRAPHQL_URL: ready.graphql,
      DEV_GIT_REMOTE: ready.remote,
      DATA_DIR: dataDir,
    });
    const { db, close } = openDatabase(":memory:", migrations);
    const engineFor = engineFactory(config, db, { log: () => {} });
    const runs = new RunQueue(db, engineFor);
    const app = createApp({ config, db, oauth: null, engineFor, runs });

    const res = await app.request("/api/repos/acme/app/stacks");
    expect(res.status).toBe(200);
    const { stacks } = (await res.json()) as StacksResponse;
    expect(stacks.map((s) => s.paths)).toEqual([
      [[9, 10, 11]],
      [
        [5, 6],
        [5, 7],
      ],
      [[1, 2, 3]],
    ]);
    expect(stacks[0]?.prs.map((pr) => [pr.number, pr.link, pr.review, pr.checks])).toEqual([
      [9, null, "approved", "success"],
      [10, "behind", "review-required", "pending"],
      [11, "intact", null, "failure"],
    ]);
    // Its timestamps are moved to the last day, so the 90-day window always holds them.
    expect(Date.now() - Date.parse(stacks[0]?.updatedAt ?? "")).toBeLessThan(86_400_000);
    await runs.idle();
    close();
  });

  it("stands in for Claude, whose sentences cite real hunks only", async () => {
    const settings = path.join(dataDir, "claude", "settings", "acme", "app.json");
    await mkdir(path.dirname(settings), { recursive: true });
    await writeFile(settings, JSON.stringify({ sendCodeToAnthropic: true }));
    const config = loadConfig({
      NODE_ENV: "test",
      DEV_AUTH_BYPASS: "1",
      DEV_GITHUB_TOKEN: "fixture",
      DEV_GITHUB_GRAPHQL_URL: ready.graphql,
      DEV_GIT_REMOTE: ready.remote,
      DEV_ANTHROPIC_BASE_URL: new URL(ready.graphql).origin,
      ANTHROPIC_API_KEY: "fixture",
      DATA_DIR: path.join(dataDir, "claude"),
    });
    const { db, close } = openDatabase(":memory:", migrations);
    const engine = engineFactory(config, db, { log: () => {} })("dev");
    const report = await engine.analyzeChange(parseChangeInput("acme/app#11"));

    expect(report.summary.map((claim) => claim.text)).toEqual([
      "Data model: migrations/ changes migrations/0042_forecast_cache.sql.",
      "Logic: app/ changes app/forecast_cache.py.",
      "Logic: app/jobs/ changes app/jobs/warm_cache.py.",
      "UI: web/admin/ changes web/admin/CacheStats.tsx.",
    ]);
    expect(report.guide.by).toBe("llm");
    expect(report.guide.sections.map((section) => [section.title, section.paths])).toEqual([
      ["Read first: the logic", ["app/forecast_cache.py", "app/jobs/warm_cache.py"]],
      ["Then the storage", ["migrations/0042_forecast_cache.sql"]],
      ["UI: web/admin/", ["web/admin/CacheStats.tsx"]],
      ["Tests: tests/", ["tests/test_warm_cache.py"]],
      ["Config & infra: lockfiles", ["uv.lock"]],
    ]);
    expect(report.parts.map((part) => part.summary.map((claim) => claim.text))).toEqual([
      ["Changes app/forecast_cache.py.", "Changes migrations/0042_forecast_cache.sql."],
      ["Changes app/jobs/warm_cache.py.", "Changes tests/test_warm_cache.py.", "Changes uv.lock."],
      ["Changes app/jobs/warm_cache.py.", "Changes web/admin/CacheStats.tsx."],
    ]);
    expect(report.analysis.model).toBe("claude-opus-5-5");
    close();
  });

  it("deletes its repo when stopped", async () => {
    expect(existsSync(ready.remote)).toBe(true);
    await stop(child);
    expect(existsSync(ready.remote)).toBe(false);
  });
});

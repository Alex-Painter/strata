import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

  it("deletes its repo when stopped", async () => {
    expect(existsSync(ready.remote)).toBe(true);
    await stop(child);
    expect(existsSync(ready.remote)).toBe(false);
  });
});

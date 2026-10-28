import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StackSummary } from "@strata/core/model";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Jobs } from "./jobs.js";
import { StackCache } from "./stack-cache.js";

let dataDir: string;
let clock: number;
let reads: number;
let release: () => void;
let held: Promise<void>;
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "strata-stack-cache-"));
  clock = Date.UTC(2026, 9, 28, 12);
  reads = 0;
  held = Promise.resolve();
});
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const scope = { userId: "usr_1", repo: "acme/app" };
const cache = () =>
  new StackCache(dataDir, new Jobs(20), { maxAgeMs: 60_000, now: () => new Date(clock) });
/** Each read lists one stack named after how many reads came before. */
const read = async (onProgress: (step: string) => void) => {
  onProgress("Finding stacks");
  await held;
  reads += 1;
  return [{ id: `read ${reads}` } as StackSummary];
};
const hold = () => {
  held = new Promise((resolve) => {
    release = resolve;
  });
};
const ids = (state: Awaited<ReturnType<StackCache["get"]>>) =>
  state.done ? state.value.stacks.map((s) => s.id) : state;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

it("waits for the first read, then answers from the last list until it's old", async () => {
  const stacks = cache();
  hold();
  expect(await stacks.get(scope, read)).toEqual({ done: false, progress: "Finding stacks" });
  release();
  expect(ids(await stacks.get(scope, read))).toEqual(["read 1"]);

  clock += 59_000;
  expect(await stacks.get(scope, read)).toMatchObject({ done: true, refreshing: false });
  expect(reads).toBe(1);

  // Old now: the last list answers at once while a new read runs behind it.
  clock += 2_000;
  hold();
  const stale = await stacks.get(scope, read);
  expect(stale).toMatchObject({ done: true, refreshing: true });
  expect(ids(stale)).toEqual(["read 1"]);
  release();
  await settle();
  expect(ids(await stacks.get(scope, read))).toEqual(["read 2"]);
});

it("keeps lists across a restart, apart for each user and repo", async () => {
  await cache().get(scope, read);
  const restarted = cache();
  expect(await restarted.get(scope, read)).toMatchObject({ done: true, refreshing: false });
  expect(ids(await restarted.get(scope, read))).toEqual(["read 1"]);
  expect(ids(await restarted.get({ ...scope, repo: "acme/other" }, read))).toEqual(["read 2"]);
  expect(ids(await restarted.get({ ...scope, userId: "usr_2" }, read))).toEqual(["read 3"]);
});

it("keeps the old list when a read behind it fails", async () => {
  const errors: unknown[] = [];
  const stacks = new StackCache(dataDir, new Jobs(20), {
    maxAgeMs: 60_000,
    now: () => new Date(clock),
    onError: (error) => errors.push(error),
  });
  await stacks.get(scope, read);
  clock += 61_000;
  const failing = async () => {
    throw new Error("GitHub is down");
  };
  expect(ids(await stacks.get(scope, failing))).toEqual(["read 1"]);
  await settle();
  expect(errors).toEqual([new Error("GitHub is down")]);
  expect(ids(await stacks.get(scope, read))).toEqual(["read 1"]);
});

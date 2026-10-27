import { describe, expect, it } from "vitest";
import { Jobs } from "./jobs.js";

/** A promise the test settles by hand. */
function gate<T>() {
  let open!: (value: T) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

describe("Jobs", () => {
  it("answers with the result when the work is quick", async () => {
    const jobs = new Jobs(50);
    expect(await jobs.run("k", async () => 42)).toEqual({ done: true, value: 42 });
  });

  it("answers with progress until the work is done, running it once", async () => {
    const jobs = new Jobs(10);
    const work = gate<string>();
    let started = 0;
    const start = (onProgress: (step: string) => void) => {
      started++;
      onProgress("Reading PRs from GitHub: 50 so far");
      return work.promise;
    };
    expect(await jobs.run("k", start)).toEqual({
      done: false,
      progress: "Reading PRs from GitHub: 50 so far",
    });
    work.open("stacks");
    expect(await jobs.run("k", start)).toEqual({ done: true, value: "stacks" });
    expect(started).toBe(1);
    // Done and collected, so the next call starts afresh.
    work.open("again");
    await jobs.run("k", start);
    expect(started).toBe(2);
  });

  it("throws the work's error to the caller that collects it", async () => {
    const jobs = new Jobs(10);
    const work = gate<string>();
    expect((await jobs.run("k", () => work.promise)).done).toBe(false);
    work.fail(new Error("GitHub has no repo acme/nope."));
    await expect(jobs.run("k", () => work.promise)).rejects.toThrow("GitHub has no repo");
  });

  it("keeps jobs with different keys apart", async () => {
    const jobs = new Jobs(10);
    const slow = gate<string>();
    expect((await jobs.run("a", () => slow.promise)).done).toBe(false);
    expect(await jobs.run("b", async () => "b")).toEqual({ done: true, value: "b" });
  });
});

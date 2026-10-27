import { describe, expect, it } from "vitest";
import { progressPrinter } from "./progress.js";

describe("progressPrinter", () => {
  it("prints each new step, and a repeating count at most every few seconds", () => {
    const lines: string[] = [];
    let clock = 0;
    const progress = progressPrinter(
      (line) => lines.push(line),
      () => clock,
    );
    progress("Finding the stack");
    for (const n of [50, 100, 150]) {
      progress(`Reading PRs from GitHub: ${n} so far`);
      clock += 1000;
    }
    clock += 1000;
    progress("Reading PRs from GitHub: 200 so far");
    progress("Cloning acme/app");
    expect(lines).toEqual([
      "… Finding the stack",
      "… Reading PRs from GitHub: 50 so far",
      "… Reading PRs from GitHub: 200 so far",
      "… Cloning acme/app",
    ]);
  });
});

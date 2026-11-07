import type { UsageEntry } from "@strata/engine";
import { describe, expect, it } from "vitest";
import { formatUsage } from "./usage.js";

const entry = (fields: Partial<UsageEntry>): UsageEntry => ({
  at: "2026-11-06T10:00:00.000Z",
  task: "whole-summary",
  model: "claude-sonnet-5-5",
  cached: false,
  inputTokens: 20_000,
  outputTokens: 3000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.07,
  ...fields,
});

describe("formatUsage", () => {
  it("totals the requests and the cost by task, model and day, newest day first", () => {
    const text = formatUsage(
      [
        entry({}),
        entry({ task: "pr-summary", model: "claude-haiku-5-5", costUsd: 0.0035 }),
        entry({ task: "pr-summary", model: "claude-haiku-5-5", cached: true, costUsd: 0 }),
        entry({ at: "2026-11-07T10:00:00.000Z", task: "chat", costUsd: 0.1 }),
        entry({ at: "2026-10-01T10:00:00.000Z", costUsd: 5 }),
      ],
      new Date("2026-11-01T00:00:00Z"),
      "/data",
    );
    expect(text.split("\n")[0]).toBe("Claude usage since 2026-11-01: 3 requests, $0.17.");
    expect(text).toMatch(/pr-summary\s+1\s+1\s+40k\s+6k\s+\$0\.00/);
    expect(text).toMatch(/claude-sonnet-5-5\s+2\s+0/);
    expect(text.indexOf("2026-11-07")).toBeLessThan(text.indexOf("2026-11-06"));
    expect(text).not.toContain("2026-10-01");
  });

  it("says so when there is nothing in the period, and marks costs it cannot price", () => {
    expect(formatUsage([], new Date("2026-11-01T00:00:00Z"), "/data")).toBe(
      "Strata did not ask Claude for anything since 2026-11-01 (/data/llm-usage.jsonl).\n",
    );
    expect(formatUsage([entry({ costUsd: null })], new Date(0), "/data")).toContain(
      "Strata does not know the price of some models.",
    );
  });
});

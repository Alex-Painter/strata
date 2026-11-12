import { describe, expect, it } from "vitest";
import { tagUsage, type UsageEntry, usageEntry } from "./llm.js";
import { summariseUsage } from "./usage.js";

const entry = (fields: Partial<UsageEntry>): UsageEntry => ({
  at: "2026-11-10T10:00:00.000Z",
  task: "whole-summary",
  model: "claude-sonnet-5-5",
  cached: false,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.5,
  ...fields,
});

describe("summariseUsage", () => {
  const since = new Date("2026-11-01T00:00:00Z");

  it("groups by task, model, day and Change, costliest first", () => {
    const summary = summariseUsage(
      [
        entry({ changeId: "chg_a", repo: "acme/app" }),
        entry({ task: "layers", model: "claude-haiku-5-5", costUsd: 0.01, changeId: "chg_a" }),
        entry({ task: "chat", costUsd: 2, changeId: "chg_b", at: "2026-11-11T09:00:00.000Z" }),
        entry({ task: "layers", model: "claude-haiku-5-5", cached: true, costUsd: 0 }),
        entry({ at: "2026-10-30T10:00:00.000Z", costUsd: 9 }),
      ],
      since,
    );
    expect(summary.total).toMatchObject({ requests: 3, cached: 1 });
    expect(summary.total.costUsd).toBeCloseTo(2.51);
    expect(summary.byTask.map((r) => [r.task, r.requests, r.cached])).toEqual([
      ["chat", 1, 0],
      ["whole-summary", 1, 0],
      ["layers", 1, 1],
    ]);
    expect(summary.byTask.find((r) => r.task === "layers")?.models).toEqual(["claude-haiku-5-5"]);
    // A cached answer ran no model.
    expect(summary.byModel.map((r) => [r.model, r.requests, r.cached])).toEqual([
      ["claude-sonnet-5-5", 2, 0],
      ["claude-haiku-5-5", 1, 0],
    ]);
    expect(summary.byDay.map((r) => r.day)).toEqual(["2026-11-11", "2026-11-10"]);
    expect(summary.byDay[1]?.costByTask).toEqual({ "whole-summary": 0.5, layers: 0.01 });
    expect(
      summary.byChange.map((r) => [r.changeId, r.repo, Math.round(r.costUsd * 100) / 100]),
    ).toEqual([
      ["chg_b", null, 2],
      ["chg_a", "acme/app", 0.51],
      [null, null, 0],
    ]);
  });

  it("keeps the cost of unknown models out of the total and counts them", () => {
    const summary = summariseUsage([entry({ costUsd: null }), entry({})], since);
    expect(summary.total).toMatchObject({ requests: 2, costUsd: 0.5, unpriced: 1 });
  });
});

describe("tagUsage", () => {
  it("adds the repo and the Change to each line", () => {
    const lines: UsageEntry[] = [];
    const llm = tagUsage(
      { client: null as never, models: {} as never, recordUsage: (e) => lines.push(e) },
      { repo: "acme/app", changeId: "chg_1" },
    );
    llm.recordUsage(
      usageEntry("layers", "claude-haiku-5-5", { input_tokens: 10, output_tokens: 1 }),
    );
    expect(lines[0]).toMatchObject({ task: "layers", repo: "acme/app", changeId: "chg_1" });
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS } from "./api.js";
import { modelsOf, usageEntry } from "./llm.js";

describe("the model for each task", () => {
  it("uses Haiku for the small jobs and Sonnet for the summary and chat by default", () => {
    expect(modelsOf({})).toEqual({
      layers: "claude-haiku-5-5",
      "pr-summary": "claude-haiku-5-5",
      "whole-summary": "claude-sonnet-5-5",
      chat: "claude-sonnet-5-5",
    });
    expect(modelsOf({})).toEqual(DEFAULT_MODELS);
  });

  it("puts every task on one model, and lets one task have its own", () => {
    expect(modelsOf({ model: "claude-opus-5-5", models: { chat: "claude-haiku-5-5" } })).toEqual({
      layers: "claude-opus-5-5",
      "pr-summary": "claude-opus-5-5",
      "whole-summary": "claude-opus-5-5",
      chat: "claude-haiku-5-5",
    });
  });
});

describe("usageEntry", () => {
  it("prices cache reads at a tenth and cache writes at 1.25 times the input price", () => {
    const entry = usageEntry("chat", "claude-opus-5-5", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });
    expect(entry.costUsd).toBeCloseTo(4 + 2 + 0.4 + 5);
    expect(usageEntry("chat", "claude-unknown", { input_tokens: 5 }).costUsd).toBeNull();
    expect(usageEntry("chat", "claude-opus-5-5", null).costUsd).toBe(0);
  });
});

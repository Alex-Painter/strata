import { describe, expect, it } from "vitest";
import { createEngine } from "./engine.js";
import { NotImplementedError } from "./errors.js";

describe("createEngine (scaffold)", () => {
  const engine = createEngine({ dataDir: "/tmp/strata-test" });

  it("rejects analysis until milestone 1 implements it", async () => {
    await expect(
      engine.analyzeChange({
        kind: "range",
        repo: { kind: "local", path: "." },
        base: "main",
        head: "HEAD",
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("rejects chat until milestone 1 implements it", async () => {
    const stream = engine.chat({
      report: {} as never,
      history: [],
      text: "why?",
      anchors: [],
    });
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(NotImplementedError);
  });
});

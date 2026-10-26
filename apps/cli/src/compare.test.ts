import { describe, expect, it } from "vitest";
import { differences } from "./compare.js";

describe("differences", () => {
  it("finds nothing in equal values, whatever their key order", () => {
    expect(differences({ a: 1, b: [{ c: 2, d: 3 }] }, { b: [{ d: 3, c: 2 }], a: 1 })).toEqual([]);
  });

  it("names each place two values differ, never the values", () => {
    const stack = {
      change: { files: [{ path: "a.py", layer: { by: "llm" } }, { path: "b.py" }] },
      notes: ["one", "two"],
      summary: [],
    };
    const range = {
      change: { files: [{ path: "a.py", layer: { by: "default" } }, { path: "b.py" }] },
      notes: ["one"],
      guide: { by: "rule" },
    };
    expect(differences(stack, range)).toEqual([
      "change.files[0].layer.by",
      "guide",
      "notes: 2 items and 1",
      "summary",
    ]);
    expect(differences(stack, range, 2)).toEqual(["change.files[0].layer.by", "guide"]);
    expect(differences(1, 2)).toEqual(["the whole value"]);
  });
});

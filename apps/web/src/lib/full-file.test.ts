import type { DiffLine, Hunk } from "@strata/core/model";
import { describe, expect, it } from "vitest";
import { fullFile } from "./full-file";

function hunk(id: string, oldStart: number, newStart: number, lines: DiffLine[]): Hunk {
  const oldLines = lines.filter((l) => l.kind !== "add").length;
  const newLines = lines.filter((l) => l.kind !== "del").length;
  return {
    id,
    path: "a.py",
    oldStart,
    oldLines,
    newStart,
    newLines,
    section: "",
    lines,
    layer: { layer: "logic", by: "rule", confidence: "high", reason: "" },
    mechanical: null,
  } as unknown as Hunk;
}

const ctx = (content: string, oldLine: number, newLine: number): DiffLine => ({
  kind: "context",
  content,
  oldLine,
  newLine,
});
const add = (content: string, newLine: number): DiffLine => ({ kind: "add", content, newLine });
const del = (content: string, oldLine: number): DiffLine => ({ kind: "del", content, oldLine });

const numbers = (lines: DiffLine[]) => lines.map((l) => [l.kind, l.oldLine, l.newLine, l.content]);

describe("fullFile", () => {
  // Base: a b c d e f g h.  Head: a b X c d e g h (X added after b, f removed).
  const head = "a\nb\nX\nc\nd\ne\ng\nh\n";
  const h1 = hunk("h1", 2, 2, [ctx("b", 2, 2), add("X", 3), ctx("c", 3, 4)]);
  const h2 = hunk("h2", 5, 6, [ctx("e", 5, 6), del("f", 6), ctx("g", 7, 7)]);

  it("puts the hunks back into the file, with both line numbers on unchanged lines", () => {
    const blocks = fullFile(head, [h2, h1]);
    expect(blocks?.map((b) => b.hunkId)).toEqual([null, "h1", null, "h2", null]);
    expect(numbers(blocks?.[0]?.lines ?? [])).toEqual([["context", 1, 1, "a"]]);
    expect(numbers(blocks?.[2]?.lines ?? [])).toEqual([["context", 4, 5, "d"]]);
    expect(numbers(blocks?.[4]?.lines ?? [])).toEqual([["context", 8, 8, "h"]]);
  });

  it("shows a deleted file as its hunks alone", () => {
    const gone = hunk("g", 1, 0, [del("a", 1), del("b", 2)]);
    expect(fullFile(null, [gone])?.map((b) => b.hunkId)).toEqual(["g"]);
  });

  it("shows an added file as one hunk", () => {
    const added = hunk("n", 0, 1, [add("a", 1), add("b", 2)]);
    expect(fullFile("a\nb", [added])?.map((b) => b.hunkId)).toEqual(["n"]);
  });

  it("handles a hunk that only removes lines", () => {
    // Base: a b c.  Head: a c.
    const only = hunk("d", 2, 1, [del("b", 2)]);
    const fixed = { ...only, newLines: 0, newStart: 1 };
    const blocks = fullFile("a\nc\n", [fixed]);
    expect(blocks?.map((b) => b.hunkId)).toEqual([null, "d", null]);
    expect(numbers(blocks?.[2]?.lines ?? [])).toEqual([["context", 3, 2, "c"]]);
  });

  it("gives null when the file does not agree with the hunks", () => {
    expect(fullFile("a\nb\nY\nc\nd\ne\ng\nh\n", [h1])).toBeNull();
    expect(fullFile("a\n", [h1])).toBeNull();
    expect(fullFile(null, [h1])).toBeNull();
    expect(fullFile(head, [h1, { ...h1, id: "again" }])).toBeNull();
  });

  it("ignores a carriage return at the end of a line", () => {
    expect(fullFile("a\r\nb\r\nX\r\nc\r\n", [h1])).not.toBeNull();
  });
});

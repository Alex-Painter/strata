import { describe, expect, it } from "vitest";
import {
  anchorForRange,
  anchorId,
  lineColumnToOffset,
  resolveAnchor,
  type SourceRef,
  sourceKey,
  surfaceText,
} from "./anchors.js";

const SPEC: SourceRef = { kind: "context", sourceId: "ctx_0000000000000001" };

describe("anchors", () => {
  const title = "# Admin settings";
  const lines = [title, "Only admins can change billing.", "Admins means org admins."];
  const text = surfaceText(lines);

  it("maps line/column positions to canonical offsets", () => {
    expect(lineColumnToOffset(lines, 0, 0)).toBe(0);
    expect(lineColumnToOffset(lines, 1, 5)).toBe(title.length + 1 + 5);
    // Columns past the end of a line clamp to the line end.
    expect(lineColumnToOffset(lines, 0, 999)).toBe(title.length);
  });

  it("round-trips a selection", () => {
    const start = text.indexOf("admins can");
    const anchor = anchorForRange(SPEC, text, { start, end: start + "admins".length });
    expect(anchor.quote).toEqual({
      exact: "admins",
      prefix: expect.stringContaining("Only "),
      suffix: expect.stringContaining(" can"),
    });
    expect(resolveAnchor(anchor, text)).toEqual({ start, end: start + 6 });
  });

  it("re-finds a quote after the text moves, using its context", () => {
    const start = text.indexOf("org admins");
    const anchor = anchorForRange(SPEC, text, { start, end: start + "org admins".length });
    const edited = `Intro paragraph added later.\n${text}`;
    const range = resolveAnchor(anchor, edited);
    expect(range && edited.slice(range.start, range.end)).toBe("org admins");
  });

  it("picks the occurrence whose context matches when the quote repeats", () => {
    // "admins" appears twice; the second one is preceded by "org ".
    const second = text.lastIndexOf("admins");
    const anchor = anchorForRange(SPEC, text, { start: second, end: second + 6 });
    const shifted = `xx${text}`;
    expect(resolveAnchor(anchor, shifted)).toEqual({ start: second + 2, end: second + 8 });
  });

  it("reports an orphaned anchor instead of guessing", () => {
    const anchor = anchorForRange(SPEC, text, { start: 0, end: 7 });
    expect(resolveAnchor(anchor, "completely different")).toBeNull();
  });

  it("gives whole-source anchors the whole text", () => {
    expect(resolveAnchor({ source: SPEC }, text)).toEqual({ start: 0, end: text.length });
  });

  it("derives keys and ids from content, not object identity", () => {
    const a = anchorForRange(SPEC, text, { start: 2, end: 7 });
    const b = anchorForRange({ ...SPEC }, text, { start: 2, end: 7 });
    expect(anchorId(a)).toBe(anchorId(b));
    expect(sourceKey({ kind: "diagram", diagramId: "d", elementId: "User" })).toBe(
      "diagram:d#User",
    );
  });
});

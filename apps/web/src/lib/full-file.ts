import type { DiffLine, Hunk } from "@strata/core/model";

/** A run of lines in a full file: a hunk's own lines, or unchanged lines between hunks. */
export interface FileBlock {
  /** The hunk these lines are, or null for unchanged lines. */
  hunkId: string | null;
  lines: DiffLine[];
}

/**
 * The whole file with its diff's hunks put back in place, like GitHub's
 * "expand all". `content` is the file at the diff's head; null when the file
 * is gone there, which only fits hunks that delete the whole file.
 *
 * Returns null when the file and the hunks do not agree (a hunk's line is not
 * in the file, or hunks overlap), so the view never shows a guess.
 */
export function fullFile(content: string | null, hunks: Hunk[]): FileBlock[] | null {
  const lines = content === null ? [] : splitLines(content);
  const sorted = [...hunks].sort((a, b) => a.newStart - b.newStart);
  if (content === null && sorted.some((hunk) => hunk.newLines > 0)) return null;
  const blocks: FileBlock[] = [];
  /** The next head line to show. */
  let next = 1;
  /** Base line number minus head line number, for unchanged lines. */
  let offset = 0;
  const gap = (until: number): boolean => {
    if (until - 1 > lines.length) return false;
    const run: DiffLine[] = [];
    for (let n = next; n < until; n++) {
      run.push({
        kind: "context",
        content: lines[n - 1] as string,
        oldLine: n + offset,
        newLine: n,
      });
    }
    if (run.length > 0) blocks.push({ hunkId: null, lines: run });
    return true;
  };
  for (const hunk of sorted) {
    // git numbers an empty side by the line before it.
    const first = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart;
    const oldFirst = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart;
    if (first < next) return null;
    if (!gap(first)) return null;
    for (const line of hunk.lines) {
      if (line.newLine === undefined) continue;
      if (trimCr(lines[line.newLine - 1]) !== trimCr(line.content)) return null;
    }
    blocks.push({ hunkId: hunk.id, lines: hunk.lines });
    next = first + hunk.newLines;
    offset = oldFirst + hunk.oldLines - next;
  }
  if (!gap(lines.length + 1)) return null;
  return blocks;
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

const trimCr = (line: string | undefined) => line?.replace(/\r$/, "");

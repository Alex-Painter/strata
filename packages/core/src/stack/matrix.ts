/**
 * The layer by PR matrix: a row per layer, a column per PR on the path, and a
 * Net column for the whole stack. Each cell counts meaningful and mechanical
 * lines and holds its files and hunks as evidence. A PR column's "revised"
 * count is the lines it added that a later PR changed again, which is why the
 * PR columns don't add up to Net.
 *
 * Net comes from the whole-stack diff only, so it's the same however the work
 * was split. The PR columns are "How it arrived".
 */
import type { Evidence, FileChange, Hunk } from "../model/change.js";
import { LAYER_IDS, type LayerId } from "../model/layers.js";
import type { ChangeReport } from "../model/report.js";
import type { PrPart } from "../model/stack.js";

export interface MatrixFile {
  path: string;
  /** Added and deleted lines in meaningful hunks. */
  meaningful: number;
  /** Lines in mechanical hunks, or every line of a mechanical file. */
  mechanical: number;
  hunkIds: string[];
}

export interface MatrixCell {
  layer: LayerId;
  /** The PR, or null for the Net column. */
  pr: number | null;
  files: MatrixFile[];
  meaningful: number;
  mechanical: number;
  /** Lines this PR added here that a later PR changed or removed. Always 0 for Net. */
  revised: number;
  /** One per hunk: the cell's claim is only as good as the hunks behind it. */
  evidence: Evidence[];
}

export interface LayerMatrix {
  /** The PRs with a column, bottom first: those on the path that have a diff. */
  prs: number[];
  /** Layers any column touches, in review order. Cells are one per PR, then Net. */
  rows: Array<{ layer: LayerId; cells: MatrixCell[] }>;
  /** The most meaningful lines in any PR cell, to shade cells against. */
  max: number;
}

export function layerMatrix(report: Pick<ChangeReport, "change" | "parts">): LayerMatrix {
  const parts = report.parts.filter((part) => part.how !== "unknown");
  const columns: Array<{ pr: number | null; files: FileChange[]; hunks: Hunk[] }> = [
    ...parts.map((part) => ({ pr: part.pr, files: part.files, hunks: part.hunks })),
    { pr: null, files: report.change.files, hunks: report.change.hunks },
  ];
  const revisedBy = new Map(parts.map((part) => [part.pr, revisedLines(part)]));

  const rows = LAYER_IDS.flatMap((layer) => {
    const cells = columns.map((column) =>
      cell(layer, column.pr, column.files, column.hunks, revisedBy.get(column.pr ?? -1)),
    );
    return cells.some((c) => c.files.length > 0) ? [{ layer, cells }] : [];
  });
  const max = Math.max(
    0,
    ...rows.flatMap((row) => row.cells.filter((c) => c.pr !== null).map((c) => c.meaningful)),
  );
  return { prs: parts.map((part) => part.pr), rows, max };
}

function cell(
  layer: LayerId,
  pr: number | null,
  files: FileChange[],
  hunks: Hunk[],
  revised: Map<string, number> | undefined,
): MatrixCell {
  const byId = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  const inLayer = files.filter((file) => file.layer.layer === layer);
  const out: MatrixCell = {
    layer,
    pr,
    files: [],
    meaningful: 0,
    mechanical: 0,
    revised: 0,
    evidence: [],
  };
  for (const file of inLayer) {
    const entry: MatrixFile = { path: file.path, meaningful: 0, mechanical: 0, hunkIds: [] };
    for (const id of file.hunkIds) {
      const hunk = byId.get(id);
      if (!hunk) continue;
      const changed = hunk.lines.filter((line) => line.kind !== "context").length;
      if (file.mechanical || hunk.mechanical) entry.mechanical += changed;
      else entry.meaningful += changed;
      entry.hunkIds.push(id);
      out.revised += revised?.get(id) ?? 0;
      out.evidence.push({
        anchor: {
          source: pr === null ? { kind: "hunk", hunkId: id } : { kind: "pr-hunk", pr, hunkId: id },
        },
        label: `${hunk.path}:${hunk.newStart}`,
      });
    }
    // A file with no hunks (a binary, a pure rename) still counts, with the file as evidence.
    if (entry.hunkIds.length === 0) {
      out.evidence.push({
        anchor: {
          source:
            pr === null
              ? { kind: "file", path: file.path, side: file.status === "deleted" ? "base" : "head" }
              : { kind: "pr", number: pr },
        },
        label: file.path,
      });
    }
    out.files.push(entry);
    out.meaningful += entry.meaningful;
    out.mechanical += entry.mechanical;
  }
  return out;
}

/** Lines of each of a part's hunks that later PRs revised. */
function revisedLines(part: PrPart): Map<string, number> {
  const lines = new Map<string, number>();
  for (const revision of part.provenance?.revisedLater ?? []) {
    lines.set(revision.hunkId, (lines.get(revision.hunkId) ?? 0) + revision.lines);
  }
  return lines;
}

/** One PR's lines by layer, for the bar on its stack map node. */
export interface PrLayerBar {
  /** Meaningful lines per layer, in review order. Layers it doesn't touch are left out. */
  segments: Array<{ layer: LayerId; lines: number }>;
  meaningful: number;
  mechanical: number;
  files: number;
}

/** Each PR column of the matrix as a bar. */
export function prLayerBars(matrix: LayerMatrix): Map<number, PrLayerBar> {
  const bars = new Map<number, PrLayerBar>(
    matrix.prs.map((pr) => [pr, { segments: [], meaningful: 0, mechanical: 0, files: 0 }]),
  );
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      const bar = cell.pr === null ? undefined : bars.get(cell.pr);
      if (!bar || cell.files.length === 0) continue;
      if (cell.meaningful > 0) bar.segments.push({ layer: row.layer, lines: cell.meaningful });
      bar.meaningful += cell.meaningful;
      bar.mechanical += cell.mechanical;
      bar.files += cell.files.length;
    }
  }
  return bars;
}

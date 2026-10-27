import type {
  ChangeReport,
  Claim,
  FileChange,
  Hunk,
  LayerId,
  PrPart,
  StackNode,
} from "@strata/core/model";
import { compareLayers } from "@strata/core/model";
import type { HunkChip } from "../components/Diff";
import { originChips, revisionChips } from "../lib/provenance";

/** What the canvas shows: the overview, or one layer of the diff in scope. */
export type View = { kind: "overview" } | { kind: "layer"; layer: LayerId };

/** Where the reviewer is: a view, and the PR it's scoped to, if any. */
export interface Nav {
  layer: LayerId | null;
  pr: number | null;
}

/** What the side panel shows details of. */
export type Selection =
  | { kind: "file"; path: string }
  | { kind: "hunk"; id: string }
  | { kind: "claim"; claim: Claim; by: string }
  | null;

/** Secondary options, behind the Display popover. */
export interface Display {
  /** The layer by PR matrix, in the whole-stack scope. */
  matrix: boolean;
  /** Which PR each hunk came from, or which later PR revised it. */
  seams: boolean;
  /** Mechanical files and hunks start folded with their reason. */
  fold: boolean;
}

export const DEFAULT_DISPLAY: Display = { matrix: false, seams: false, fold: true };

/** The diff in scope: the whole stack's (or range's), or one PR's own. */
export interface ScopedDiff {
  pr: number | null;
  files: FileChange[];
  hunks: Hunk[];
  byId: Map<string, Hunk>;
  byPath: Map<string, FileChange>;
  /** Seam chips by hunk id: "from #N" for the whole stack, "revised in #N" for a PR. */
  chips: Map<string, HunkChip[]>;
}

export function scopedDiff(report: ChangeReport, part: PrPart | null): ScopedDiff {
  const files = part ? part.files : report.change.files;
  const hunks = part ? part.hunks : report.change.hunks;
  return {
    pr: part?.pr ?? null,
    files,
    hunks,
    byId: new Map(hunks.map((hunk) => [hunk.id, hunk])),
    byPath: new Map(files.map((file) => [file.path, file])),
    chips: part ? revisionChips(part) : originChips(report.parts),
  };
}

/** The layers the whole Change touches, in review order. Every scope keeps the same list. */
export function changeLayers(report: ChangeReport): LayerId[] {
  const layers = new Set<LayerId>(report.change.files.map((file) => file.layer.layer));
  for (const part of report.parts) for (const file of part.files) layers.add(file.layer.layer);
  return [...layers].sort(compareLayers);
}

/** A layer's files in the diff, by directory and then name. */
export function filesIn(diff: ScopedDiff, layer: LayerId): FileChange[] {
  return diff.files
    .filter((file) => file.layer.layer === layer)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function hunksOf(file: FileChange, diff: ScopedDiff): Hunk[] {
  return file.hunkIds.map((id) => diff.byId.get(id)).filter((hunk) => hunk !== undefined);
}

/** The PR a scope is on, when it's one of the stack's path. */
export function scopedNode(report: ChangeReport, pr: number | null): StackNode | null {
  if (pr === null || !report.stack?.selectedPath.includes(pr)) return null;
  return report.stack.nodes.find((node) => node.pr.number === pr) ?? null;
}

/** Every sentence written about the diff in scope, with what it was written from. */
export function claimsIn(
  report: ChangeReport,
  part: PrPart | null,
): Array<{ claim: Claim; by: string }> {
  if (part) return part.summary.map((claim) => ({ claim, by: `#${part.pr}'s own diff` }));
  const whole = report.stack ? "the whole-stack diff" : "the range's diff";
  return [
    ...report.summary.map((claim) => ({ claim, by: whole })),
    ...report.guide.sections.flatMap((section) =>
      section.about.map((claim) => ({ claim, by: `the Guide's “${section.title}”` })),
    ),
  ];
}

/** The hunk ids a sentence cites. */
export function citedIds(claim: Claim): string[] {
  return claim.evidence.flatMap((item) => {
    const { source } = item.anchor;
    return source.kind === "hunk" || source.kind === "pr-hunk" ? [source.hunkId] : [];
  });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

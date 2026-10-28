/**
 * Turns diff text into files and hunks. This is the one place where diff text
 * becomes the domain model, and it stays a pure function of the diff: the same
 * text gives the same files, hunks and ids, however the work was split.
 *
 * Layers and mechanical checks plug in through a classifier (layers/classify.ts).
 * Without one, every file and hunk is marked unclassified, nothing is
 * mechanical, and no layer groups are made.
 */
import { parseDiff } from "../diff/parse.js";
import type { Classifier } from "../layers/classify.js";
import type { FileChange, Hunk, LayerAssignment, LayerGroup } from "../model/change.js";
import { stableId } from "../model/ids.js";
import { compareLayers, type LayerId } from "../model/layers.js";

export const UNCLASSIFIED: LayerAssignment = {
  layer: "other",
  by: "default",
  reason: "Strata did not assign layers at this time.",
  confidence: "low",
};

export interface DiffModel {
  /** By path, so the order of files in the diff text never matters. */
  files: FileChange[];
  /** In file order, then hunk order. */
  hunks: Hunk[];
  /** Empty until files are classified. */
  layers: LayerGroup[];
}

export interface BuildDiffOptions {
  classifier?: Classifier;
}

export function buildDiff(diff: string, options: BuildDiffOptions = {}): DiffModel {
  const parsed = parseDiff(diff).sort((a, b) => compareStrings(a.path, b.path));
  const files: FileChange[] = [];
  const hunks: Hunk[] = [];

  const { classifier } = options;
  for (const file of parsed) {
    const layer = classifier?.layer(file) ?? UNCLASSIFIED;
    const fileMechanical = classifier?.mechanicalFile(file) ?? null;
    const inspect = classifier?.inspect(file, layer, fileMechanical) ?? [];
    const seen = new Map<string, number>();
    const hunkIds: string[] = [];
    let additions = 0;
    let deletions = 0;

    for (const parsedHunk of file.hunks) {
      const body = parsedHunk.lines.map((l) => `${l.kind}:${l.content}`).join("\n");
      // Identical hunks in one file (a pasted block, say) need distinct ids;
      // the occurrence count keeps them stable without using positions.
      const occurrence = seen.get(body) ?? 0;
      seen.set(body, occurrence + 1);
      const id = stableId("hunk", file.path, body, String(occurrence));

      for (const line of parsedHunk.lines) {
        if (line.kind === "add") additions++;
        else if (line.kind === "del") deletions++;
      }
      hunkIds.push(id);
      hunks.push({
        id,
        path: file.path,
        oldStart: parsedHunk.oldStart,
        oldLines: parsedHunk.oldLines,
        newStart: parsedHunk.newStart,
        newLines: parsedHunk.newLines,
        section: parsedHunk.section,
        lines: parsedHunk.lines,
        layer,
        // A mechanical file's hunks are mechanical for the same reason.
        mechanical: fileMechanical ?? classifier?.mechanicalHunk(parsedHunk) ?? null,
      });
    }

    files.push({
      path: file.path,
      ...(file.oldPath !== undefined ? { oldPath: file.oldPath } : {}),
      status: file.status,
      binary: file.binary,
      ...(file.similarity !== undefined ? { similarity: file.similarity } : {}),
      ...(file.oldMode !== undefined ? { oldMode: file.oldMode } : {}),
      ...(file.newMode !== undefined ? { newMode: file.newMode } : {}),
      hunkIds,
      additions,
      deletions,
      mechanical: fileMechanical,
      layer,
      inspect,
    });
  }

  return { files, hunks, layers: classifier ? groupByLayer(files, hunks) : [] };
}

function groupByLayer(files: FileChange[], hunks: Hunk[]): LayerGroup[] {
  const byId = new Map(hunks.map((h) => [h.id, h]));
  const groups = new Map<LayerId, LayerGroup>();
  for (const file of files) {
    const layer = file.layer.layer;
    let group = groups.get(layer);
    if (!group) {
      group = { layer, files: [], meaningfulHunks: 0, mechanicalHunks: 0 };
      groups.set(layer, group);
    }
    group.files.push({ path: file.path, hunkIds: file.hunkIds });
    for (const id of file.hunkIds) {
      if (byId.get(id)?.mechanical) group.mechanicalHunks++;
      else group.meaningfulHunks++;
    }
  }
  return [...groups.values()].sort((a, b) => compareLayers(a.layer, b.layer));
}

/** Locale-independent ordering, so output is identical on every machine. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

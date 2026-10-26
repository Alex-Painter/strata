/**
 * Where each PR's lines went, from git blame over Strata's own chain of
 * commits (one per PR, see parts.ts). Forward blame at the top of the stack
 * names the PR behind each line the whole stack adds; reverse blame names the
 * PR that removed each trunk line, and the later PR that changed each line a
 * PR added.
 *
 * Mechanical and binary files aren't traced: a lockfile's lines say nothing
 * about who changed what, and blaming them is slow.
 */
import type { DiffModel, FileChange, Hunk, PartProvenance, PrPart } from "@strata/core";
import { blame } from "../git/diff.js";
import { runLimited } from "../limit.js";

/** Blames run a few at a time, so a big stack doesn't start hundreds of gits. */
const CONCURRENCY = 8;

/** One PR on Strata's chain, bottom first, with the commit that ends its diff. */
export interface ChainLink {
  pr: number;
  commit: string;
}

export async function buildProvenance(
  gitDir: string,
  base: string,
  chain: ChainLink[],
  whole: DiffModel,
  parts: Array<Pick<PrPart, "pr" | "files" | "hunks">>,
): Promise<Map<number, PartProvenance>> {
  const result = new Map<number, PartProvenance>(
    chain.map((link) => [link.pr, { inWhole: [], revisedLater: [] }]),
  );
  const top = chain[chain.length - 1]?.commit;
  if (!top) return result;
  // Position on the chain: 0 is the trunk, 1 the bottom PR's commit, and so on.
  const position = new Map([base, ...chain.map((link) => link.commit)].map((c, i) => [c, i]));
  const prAt = (i: number) => chain[i - 1]?.pr;
  const tasks: Array<() => Promise<void>> = [];

  // The whole stack: who wrote each added line, and who removed each trunk line.
  const inWhole = new Map<number, Map<string, { added: number; removed: number }>>();
  const count = (pr: number | undefined, hunkId: string, key: "added" | "removed") => {
    if (pr === undefined) return;
    const hunks = inWhole.get(pr) ?? new Map();
    inWhole.set(pr, hunks);
    const entry = hunks.get(hunkId) ?? { added: 0, removed: 0 };
    hunks.set(hunkId, entry);
    entry[key]++;
  };
  for (const { file, hunks } of traced(whole.files, whole.hunks)) {
    if (hunks.some((hunk) => lines(hunk, "add").length > 0)) {
      tasks.push(async () => {
        const commits = await blame(gitDir, base, top, file.path);
        for (const hunk of hunks) {
          for (const n of lines(hunk, "add")) {
            const at = position.get(commits[n] ?? "");
            if (at) count(prAt(at), hunk.id, "added");
          }
        }
      });
    }
    if (hunks.some((hunk) => lines(hunk, "del").length > 0)) {
      tasks.push(async () => {
        const last = await blame(gitDir, base, top, file.oldPath ?? file.path, { reverse: true });
        for (const hunk of hunks) {
          for (const n of lines(hunk, "del")) {
            // The line was last there at `at`, so the next PR removed it.
            const at = position.get(last[n] ?? "");
            if (at !== undefined && at < chain.length) count(prAt(at + 1), hunk.id, "removed");
          }
        }
      });
    }
  }

  // Each PR's own lines that a later PR changed or removed. The top PR has no later PR.
  const revised = new Map<number, Map<string, Map<number, number>>>();
  for (const link of chain.slice(0, -1)) {
    const part = parts.find((p) => p.pr === link.pr);
    if (!part) continue;
    for (const { file, hunks } of traced(part.files, part.hunks)) {
      if (!hunks.some((hunk) => lines(hunk, "add").length > 0)) continue;
      tasks.push(async () => {
        const last = await blame(gitDir, link.commit, top, file.path, { reverse: true });
        for (const hunk of hunks) {
          for (const n of lines(hunk, "add")) {
            const at = position.get(last[n] ?? "");
            if (at === undefined || at === chain.length) continue;
            const by = prAt(at + 1);
            if (by === undefined) continue;
            const ofPr = revised.get(link.pr) ?? new Map();
            revised.set(link.pr, ofPr);
            const ofHunk = ofPr.get(hunk.id) ?? new Map();
            ofPr.set(hunk.id, ofHunk);
            ofHunk.set(by, (ofHunk.get(by) ?? 0) + 1);
          }
        }
      });
    }
  }

  await runLimited(tasks, CONCURRENCY);

  // In diff order, so the result doesn't depend on which blame finished first.
  const wholeOrder = new Map(whole.hunks.map((hunk, i) => [hunk.id, i]));
  for (const link of chain) {
    const provenance = result.get(link.pr) as PartProvenance;
    provenance.inWhole = [...(inWhole.get(link.pr) ?? new Map()).entries()]
      .sort(([a], [b]) => (wholeOrder.get(a) ?? 0) - (wholeOrder.get(b) ?? 0))
      .map(([hunkId, counts]) => ({ hunkId, ...counts }));
    const part = parts.find((p) => p.pr === link.pr);
    const partOrder = new Map(part?.hunks.map((hunk, i) => [hunk.id, i]) ?? []);
    provenance.revisedLater = [...(revised.get(link.pr) ?? new Map()).entries()]
      .sort(([a], [b]) => (partOrder.get(a) ?? 0) - (partOrder.get(b) ?? 0))
      .flatMap(([hunkId, byPr]: [string, Map<number, number>]) =>
        [...byPr.entries()]
          .sort(([a], [b]) => chainIndex(chain, a) - chainIndex(chain, b))
          .map(([by, n]) => ({ hunkId, by, lines: n })),
      );
  }
  return result;
}

/** Files worth tracing, with their hunks. */
function traced(files: FileChange[], hunks: Hunk[]): Array<{ file: FileChange; hunks: Hunk[] }> {
  const byId = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  return files
    .filter((file) => !file.binary && !file.mechanical)
    .map((file) => ({
      file,
      hunks: file.hunkIds
        .map((id) => byId.get(id))
        .filter((hunk): hunk is Hunk => hunk !== undefined && hunk.mechanical === null),
    }))
    .filter(({ hunks }) => hunks.length > 0);
}

/** A hunk's added lines by their new number, or deleted lines by their old one. */
function lines(hunk: Hunk, kind: "add" | "del"): number[] {
  return hunk.lines.flatMap((line) => {
    if (line.kind !== kind) return [];
    const n = kind === "add" ? line.newLine : line.oldLine;
    return n === undefined ? [] : [n];
  });
}

function chainIndex(chain: ChainLink[], pr: number): number {
  return chain.findIndex((link) => link.pr === pr);
}

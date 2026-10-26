import type { PrPart } from "@strata/core/model";
import type { HunkChip } from "../components/Diff";

const lines = (n: number) => (n === 1 ? "1 line" : `${n} lines`);

/** For the whole stack: the PRs each hunk's lines came from, bottom first. */
export function originChips(parts: PrPart[]): Map<string, HunkChip[]> {
  const chips = new Map<string, HunkChip[]>();
  for (const part of parts) {
    for (const share of part.provenance?.inWhole ?? []) {
      const did = [
        share.added > 0 ? `added ${lines(share.added)}` : null,
        share.removed > 0 ? `removed ${lines(share.removed)}` : null,
      ].filter(Boolean);
      const list = chips.get(share.hunkId) ?? [];
      list.push({
        pr: part.pr,
        text: `from #${part.pr}`,
        title: `#${part.pr} ${did.join(" and ")} of this hunk.`,
      });
      chips.set(share.hunkId, list);
    }
  }
  return chips;
}

/** For one PR: its hunks that a later PR changed again. */
export function revisionChips(part: PrPart): Map<string, HunkChip[]> {
  const chips = new Map<string, HunkChip[]>();
  for (const revision of part.provenance?.revisedLater ?? []) {
    const list = chips.get(revision.hunkId) ?? [];
    list.push({
      pr: revision.by,
      text: `revised in #${revision.by}`,
      title: `${lines(revision.lines)} of this hunk ${revision.lines === 1 ? "was" : "were"} changed again in #${revision.by}.`,
    });
    chips.set(revision.hunkId, list);
  }
  return chips;
}

/** The later PRs that changed a PR's lines, with how many, in path order. */
export function revisedBy(part: PrPart, path: number[]): Array<{ pr: number; lines: number }> {
  const byPr = new Map<number, number>();
  for (const revision of part.provenance?.revisedLater ?? []) {
    byPr.set(revision.by, (byPr.get(revision.by) ?? 0) + revision.lines);
  }
  return [...byPr.entries()]
    .sort(([a], [b]) => path.indexOf(a) - path.indexOf(b))
    .map(([pr, n]) => ({ pr, lines: n }));
}

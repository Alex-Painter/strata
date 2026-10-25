/**
 * The shape-invariance view of a report: everything the whole-stack view
 * shows, minus what may depend on how the work was split. That is the stack
 * and each PR's part ("How it arrived"), the hints, the id and title (both
 * come from the PRs), the revisions (each split ends at a different commit
 * with the same tree), PR descriptions and run metadata.
 *
 * The shape-invariance tests compare this for the same feature split
 * different ways. Any difference is a bug (SPEC.md, "Benchmarks", 1).
 */
import type { ChangeReport } from "../model/report.js";

export function canonicalReport(report: ChangeReport): unknown {
  const { analysis: _analysis, stack: _stack, parts: _parts, change, sources, ...rest } = report;
  const { id: _id, title: _title, revisions: _revisions, hints: _hints, ...whole } = change;
  return {
    ...rest,
    change: whole,
    // A stack has one description per PR, so they depend on the split.
    sources: sources.filter((source) => source.kind !== "pr-description"),
  };
}

/** JSON with sorted keys, so equal values serialise the same. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

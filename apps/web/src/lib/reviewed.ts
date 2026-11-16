import type { ChangeSummary } from "@strata/core/model";

/** The Reviewed page shows the stacks you were on in this many days; older ones wait behind a button. */
export const REVIEWED_DAYS = 14;

/**
 * When you were last on a Change: the newest time GitHub listed one of your
 * PRs on it for you, else the last time Strata saved it.
 */
export function lastOn(change: ChangeSummary): string {
  const seen = change.yours.map((pr) => pr.seenAt).sort();
  return seen.at(-1) ?? change.updatedAt;
}

/**
 * The Changes that you were assigned or reviewed but that do not wait on you,
 * newest first, split at REVIEWED_DAYS before `now`.
 */
export function reviewedChanges(
  changes: ChangeSummary[],
  now: Date,
): { recent: ChangeSummary[]; older: ChangeSummary[] } {
  const cutoff = now.getTime() - REVIEWED_DAYS * 24 * 60 * 60 * 1000;
  const reviewed = changes
    .filter((c) => !c.waiting && (c.yours.length > 0 || c.origin === "assigned"))
    .sort((a, b) => lastOn(b).localeCompare(lastOn(a)));
  return {
    recent: reviewed.filter((c) => Date.parse(lastOn(c)) >= cutoff),
    older: reviewed.filter((c) => Date.parse(lastOn(c)) < cutoff),
  };
}

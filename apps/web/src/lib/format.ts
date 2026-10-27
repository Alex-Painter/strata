/** Words and dates for PR metadata, shared by the stack map and the panes. */
import type { FileStatus, LinkState, PrState, StackPr } from "@strata/core/model";

export function stateLabel(pr: { state: PrState; draft: boolean }): string {
  if (pr.state === "open") return pr.draft ? "Draft" : "Open";
  return pr.state === "merged" ? "Merged" : "Closed";
}

export const REVIEW_LABEL: Record<NonNullable<StackPr["review"]>, string> = {
  approved: "Approved",
  "changes-requested": "Changes requested",
  "review-required": "Review required",
};

export const CHECKS_LABEL: Record<NonNullable<StackPr["checks"]>, string> = {
  success: "Checks pass",
  failure: "Checks fail",
  pending: "Checks running",
};

/** Whether the PR is open and behind or off its parent, so it needs a restack. */
export function needsRestack(pr: { link: LinkState | null; state: PrState }): boolean {
  return pr.state === "open" && (pr.link === "behind" || pr.link === "stale");
}

/** How a PR sits on the one below, in a few words. Null when there's nothing to say. */
export function linkLabel(
  pr: { link: LinkState | null; state: PrState; baseRef: string },
  parent: number | null,
): string | null {
  const restack = needsRestack(pr) ? ": needs a restack" : "";
  switch (pr.link) {
    case "behind":
      return `Behind #${parent}${restack}`;
    case "stale":
      return `On an old push of #${parent}${restack}`;
    case "re-anchored":
      return `Now on ${pr.baseRef}`;
    case "merged-into-parent":
      return `Merged into #${parent}`;
    case "unknown":
      return `Can't tell how it sits on #${parent}`;
    default:
      return null;
  }
}

/** One sentence on what a link state means, for the PR pane. */
export const LINK_MEANING: Record<LinkState, string> = {
  intact: "It contains its parent's head, so its own changes start there.",
  behind:
    "Its parent got new commits after it branched, so its own changes start at the last parent commit it has.",
  stale:
    "Its parent was force-pushed after it branched, so its own changes start at the old parent commit it sits on.",
  "re-anchored":
    "It sits on its base branch now rather than on its parent, so its own changes start where it last met that branch.",
  "merged-into-parent": "It was merged into its parent's branch rather than the trunk.",
  unknown: "Git couldn't tell where its own changes start, usually because a commit is missing.",
};

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const formatDate = (iso: string) => DATE.format(new Date(iso));

/** "3h ago", "2d ago", or the date once it's more than a month old. */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days <= 30 ? `${days}d ago` : formatDate(iso);
}

export const prCount = (n: number) => (n === 1 ? "1 PR" : `${n} PRs`);

/** "3 PRs: 2 open, 1 merged". */
export function countPrs(prs: { state: PrState }[]): string {
  const counts = (["open", "merged", "closed"] as const)
    .map((state) => [state, prs.filter((pr) => pr.state === state).length] as const)
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${state}`);
  return `${prCount(prs.length)}: ${counts.join(", ")}`;
}

/** "#5 → #7", or "#1 → … → #23" for long paths. */
export function describePath(path: number[]): string {
  const names = path.map((n) => `#${n}`);
  return names.length <= 3 ? names.join(" → ") : `${names[0]} → … → ${names[names.length - 1]}`;
}

export const FILE_STATUS: Record<FileStatus, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
};

/** `+40 −3`, with a real minus sign. */
export function lineCount(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`;
}

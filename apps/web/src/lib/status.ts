import type { PathPr } from "@strata/core/model";

export type ReviewStatusKind =
  | "merged"
  | "closed"
  | "needs-you"
  | "draft"
  | "changes-requested"
  | "checks-failed"
  | "ready"
  | "reviewed"
  | "needs-review";

export interface ReviewStatus {
  kind: ReviewStatusKind;
  label: string;
  /** The GitHub facts behind the label, one sentence for each PR. */
  detail: string;
  /** The same facts, one item for each PR, for a list. */
  lines: string[];
}

const LABEL: Record<ReviewStatusKind, string> = {
  merged: "Merged",
  closed: "Closed",
  "needs-you": "Needs your review",
  draft: "Draft",
  "changes-requested": "Changes requested",
  "checks-failed": "Checks failed",
  ready: "Ready to merge",
  reviewed: "Reviewed by you",
  "needs-review": "Needs review",
};

/**
 * One status for a path of PRs, from GitHub's state, reviews and checks and
 * from what GitHub asks of you. The first rule that matches wins.
 */
export function reviewStatus(
  prs: PathPr[],
  you: { waiting: boolean; reviewed: boolean; reviewedPrs?: ReadonlySet<number> },
): ReviewStatus | null {
  const open = prs.filter((pr) => pr.state === "open");
  const kind = ((): ReviewStatusKind | null => {
    if (prs.length > 0 && prs.every((pr) => pr.state === "merged")) return "merged";
    if (prs.length > 0 && open.length === 0) return "closed";
    if (you.waiting) return "needs-you";
    if (open.length === 0) return you.reviewed ? "reviewed" : null;
    if (open.some((pr) => pr.draft)) return "draft";
    if (open.some((pr) => pr.review === "changes-requested")) return "changes-requested";
    if (open.some((pr) => pr.checks === "failure")) return "checks-failed";
    if (open.every((pr) => pr.review === "approved" && pr.checks !== "pending")) return "ready";
    if (you.reviewed) return "reviewed";
    return "needs-review";
  })();
  if (!kind) return null;
  const lines = prs.map((pr) => describe(pr, you.reviewedPrs?.has(pr.number) ?? false));
  return { kind, label: LABEL[kind], detail: lines.join(" "), lines };
}

function describe(pr: PathPr, reviewedByYou: boolean): string {
  if (pr.state !== "open") return `#${pr.number} is ${pr.state}.`;
  const review =
    pr.review === "approved"
      ? "is approved"
      : pr.review === "changes-requested"
        ? "has requested changes"
        : reviewedByYou
          ? "has your review"
          : "needs a review";
  const checks =
    pr.checks === "success"
      ? " Its checks passed."
      : pr.checks === "failure"
        ? " Its checks failed."
        : pr.checks === "pending"
          ? " Its checks did not finish."
          : "";
  return `#${pr.number}${pr.draft ? " is a draft and" : ""} ${review}.${checks}`;
}

import type { PrState, StackPr } from "@strata/core/model";
import { CHECKS_LABEL, REVIEW_LABEL, stateLabel } from "../lib/format";

const STATE_CLASS: Record<string, string> = {
  Open: "text-open border-open/40",
  Draft: "text-muted border-line",
  Merged: "text-merged border-merged/40",
  Closed: "text-closed border-closed/40",
};

export function StateBadge({ pr }: { pr: { state: PrState; draft: boolean } }) {
  const label = stateLabel(pr);
  return (
    <span
      className={`inline-flex h-4 items-center rounded-full border px-1.5 text-[11px] leading-none font-medium ${STATE_CLASS[label]}`}
    >
      {label}
    </span>
  );
}

/** Review and CI status as two small marks, each with its words for screen readers and hover. */
export function ReviewMarks({ pr }: { pr: Pick<StackPr, "review" | "checks"> }) {
  return (
    <>
      {pr.review && (
        <span
          role="img"
          aria-label={REVIEW_LABEL[pr.review]}
          title={REVIEW_LABEL[pr.review]}
          className={
            pr.review === "approved"
              ? "text-open"
              : pr.review === "changes-requested"
                ? "text-closed"
                : "text-muted"
          }
        >
          {pr.review === "approved" ? "✓" : pr.review === "changes-requested" ? "±" : "○"}
        </span>
      )}
      {pr.checks && (
        <span
          role="img"
          aria-label={CHECKS_LABEL[pr.checks]}
          title={CHECKS_LABEL[pr.checks]}
          className={`inline-block size-2 rounded-full ${
            pr.checks === "success" ? "bg-open" : pr.checks === "failure" ? "bg-closed" : "bg-warn"
          }`}
        />
      )}
    </>
  );
}

import type { PrState, StackPr } from "@strata/core/model";
import { CHECKS_LABEL, REVIEW_LABEL, stateLabel } from "../lib/format";

/** A PR's state as a word in an outline pill. */
export function StateBadge({ pr }: { pr: { state: PrState; draft: boolean } }) {
  return <span className="pill h-4 px-1.5 text-[12px]">{stateLabel(pr)}</span>;
}

/** Review and CI status, as words. */
export function ReviewMarks({ pr }: { pr: Pick<StackPr, "review" | "checks"> }) {
  const words = [pr.review && REVIEW_LABEL[pr.review], pr.checks && CHECKS_LABEL[pr.checks]];
  const text = words.filter(Boolean).join(" · ");
  return text ? <span className="truncate">{text}</span> : null;
}

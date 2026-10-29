import type { PathPr } from "@strata/core/model";
import { expect, it } from "vitest";
import { reviewStatus } from "./status";

const pr = (number: number, fields: Partial<PathPr> = {}): PathPr => ({
  number,
  author: "sam",
  createdAt: "2026-10-01T00:00:00Z",
  state: "open",
  draft: false,
  review: "review-required",
  checks: "success",
  ...fields,
});
const nobody = { waiting: false, reviewed: false };
const label = (prs: PathPr[], you = nobody) => reviewStatus(prs, you)?.label;

it("names one status for a path, the first rule that matches", () => {
  expect(label([pr(1, { state: "merged" }), pr(2, { state: "merged" })])).toBe("Merged");
  expect(label([pr(1, { state: "merged" }), pr(2, { state: "closed" })])).toBe("Closed");
  expect(label([pr(1)], { waiting: true, reviewed: false })).toBe("Needs your review");
  expect(label([pr(1), pr(2, { draft: true })])).toBe("Draft");
  expect(label([pr(1, { review: "changes-requested" }), pr(2, { checks: "failure" })])).toBe(
    "Changes requested",
  );
  expect(label([pr(1, { review: "approved", checks: "failure" })])).toBe("Checks failed");
  // Merged PRs on the path do not hold the rest back.
  expect(label([pr(1, { state: "merged" }), pr(2, { review: "approved" })])).toBe("Ready to merge");
  expect(label([pr(1, { review: "approved", checks: "pending" })])).toBe("Needs review");
  expect(label([pr(1)], { waiting: false, reviewed: true })).toBe("Reviewed by you");
  expect(label([pr(1)])).toBe("Needs review");
});

it("shows the GitHub facts behind the status", () => {
  const status = reviewStatus(
    [pr(1, { state: "merged" }), pr(2, { review: "approved", checks: "failure" }), pr(3)],
    nobody,
  );
  expect(status?.detail).toBe(
    "#1 is merged. #2 is approved. Its checks failed. #3 needs a review. Its checks passed.",
  );
});

it("has nothing to say about a Change that Strata has not read since it kept PRs", () => {
  expect(reviewStatus([], nobody)).toBeNull();
  expect(reviewStatus([], { waiting: true, reviewed: false })?.label).toBe("Needs your review");
});

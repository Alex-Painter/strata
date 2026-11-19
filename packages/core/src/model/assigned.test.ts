import { describe, expect, it } from "vitest";
import type { PathPr } from "./api.js";
import { allApproved, waitsOnYou } from "./assigned.js";

describe("waitsOnYou", () => {
  it("waits on an assignment or a review request until you review", () => {
    expect(waitsOnYou([{ kind: "assignee" }])).toBe(true);
    expect(waitsOnYou([{ kind: "review-requested", direct: false, teams: ["acme/web"] }])).toBe(
      true,
    );
    expect(waitsOnYou([])).toBe(false);
  });

  it("stops waiting once you review, unless GitHub asks you by name again", () => {
    expect(waitsOnYou([{ kind: "reviewed" }])).toBe(false);
    expect(waitsOnYou([{ kind: "assignee" }, { kind: "reviewed" }])).toBe(false);
    expect(
      waitsOnYou([
        { kind: "review-requested", direct: false, teams: ["acme/web"] },
        { kind: "reviewed" },
      ]),
    ).toBe(false);
    expect(
      waitsOnYou([{ kind: "review-requested", direct: true, teams: [] }, { kind: "reviewed" }]),
    ).toBe(true);
  });
});

describe("allApproved", () => {
  const pr = (number: number, more: Partial<PathPr> = {}): PathPr => ({
    number,
    author: "sam",
    createdAt: "2026-11-01T00:00:00Z",
    state: "open",
    draft: false,
    review: "review-required",
    checks: null,
    ...more,
  });

  it("is true when GitHub approves every open PR", () => {
    expect(allApproved([pr(1, { review: "approved" }), pr(2, { review: "approved" })])).toBe(true);
  });

  it("counts an approval GitHub leaves out, such as a bot's", () => {
    expect(allApproved([pr(1, { review: "approved" }), pr(2, { latestReview: "approved" })])).toBe(
      true,
    );
    expect(allApproved([pr(1, { review: null, latestReview: "approved" })])).toBe(true);
  });

  it("is false while one open PR has no approval", () => {
    expect(allApproved([pr(1, { review: "approved" }), pr(2)])).toBe(false);
    expect(allApproved([pr(1, { review: "approved" }), pr(2, { latestReview: null })])).toBe(false);
  });

  it("is false when someone asks for changes, even after an approval", () => {
    expect(allApproved([pr(1, { review: "approved", latestReview: "changes-requested" })])).toBe(
      false,
    );
    expect(allApproved([pr(1, { review: "changes-requested", latestReview: "approved" })])).toBe(
      false,
    );
  });

  it("leaves out merged and closed PRs, and needs one open PR", () => {
    expect(allApproved([pr(1, { state: "merged" }), pr(2, { review: "approved" })])).toBe(true);
    expect(allApproved([pr(1, { state: "merged" }), pr(2, { state: "closed" })])).toBe(false);
    expect(allApproved([])).toBe(false);
  });
});

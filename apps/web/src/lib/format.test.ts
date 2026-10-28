import type { LinkState } from "@strata/core/model";
import { describe, expect, it } from "vitest";
import {
  ago,
  countPrs,
  describePath,
  linkLabel,
  needsRestack,
  stateLabel,
  yoursLabel,
} from "./format";

describe("format", () => {
  it("counts PRs by state, leaving out states with none", () => {
    expect(countPrs([{ state: "open" }])).toBe("1 PR: 1 open");
    expect(countPrs([{ state: "merged" }, { state: "open" }, { state: "open" }])).toBe(
      "3 PRs: 2 open, 1 merged",
    );
  });

  it("shortens long paths to their ends", () => {
    expect(describePath([5, 7])).toBe("#5 → #7");
    expect(describePath([1, 2, 3])).toBe("#1 → #2 → #3");
    expect(describePath([1, 2, 3, 4])).toBe("#1 → … → #4");
  });

  it("names a draft as a draft only while it's open", () => {
    expect(stateLabel({ state: "open", draft: true })).toBe("Draft");
    expect(stateLabel({ state: "merged", draft: true })).toBe("Merged");
  });

  it("only labels links worth a reader's attention", () => {
    const pr = (link: LinkState | null, baseRef = "b9") => ({
      link,
      state: "open" as const,
      baseRef,
    });
    expect(linkLabel(pr("intact"), 9)).toBeNull();
    expect(linkLabel(pr(null, "main"), null)).toBeNull();
    expect(linkLabel(pr("behind"), 9)).toBe("Behind #9: needs a restack");
    expect(linkLabel(pr("re-anchored", "main"), 1)).toBe("Now on main");
  });

  it("asks only an open PR for a restack", () => {
    const behind = { link: "behind" as const, baseRef: "b9" };
    expect(linkLabel({ ...behind, state: "merged" }, 9)).toBe("Behind #9");
    expect(linkLabel({ ...behind, link: "stale", state: "closed" }, 9)).toBe(
      "On an old push of #9",
    );
    expect(needsRestack({ ...behind, state: "open" })).toBe(true);
    expect(needsRestack({ ...behind, state: "merged" })).toBe(false);
  });

  it("says how long ago, then the date once it's old", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    expect(ago("2026-10-25T11:59:40Z", now)).toBe("just now");
    expect(ago("2026-10-25T09:00:00Z", now)).toBe("3h ago");
    expect(ago("2026-10-20T12:00:00Z", now)).toBe("5d ago");
    expect(ago("2026-08-01T12:00:00Z", now)).toBe("1 Aug 2026");
  });
});

describe("yoursLabel", () => {
  const seenAt = "2026-10-28T00:00:00Z";
  it("says why each PR still waits on you", () => {
    expect(
      yoursLabel([
        { number: 3, reasons: [{ kind: "assignee" }], active: true, seenAt },
        {
          number: 4,
          reasons: [{ kind: "review-requested", direct: false, teams: ["acme/backend"] }],
          active: true,
          seenAt,
        },
        { number: 5, reasons: [{ kind: "assignee" }], active: false, seenAt },
      ]),
    ).toBe("#3 assigned · #4 review requested from acme/backend");
  });

  it("falls back to the PRs you were on once none waits", () => {
    expect(
      yoursLabel([
        {
          number: 5,
          reasons: [{ kind: "assignee" }, { kind: "review-requested", direct: true, teams: [] }],
          active: false,
          seenAt,
        },
      ]),
    ).toBe("#5 assigned, review requested");
  });
});

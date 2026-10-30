import { describe, expect, it } from "vitest";
import { waitsOnYou } from "./assigned.js";

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

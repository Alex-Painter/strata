import { describe, expect, it } from "vitest";
import { inputHint } from "./input";

describe("inputHint", () => {
  it("says nothing until something is typed", () => {
    expect(inputHint("  ")).toBeNull();
  });

  it("reads back each way of naming a stack", () => {
    const cases: [string, string][] = [
      ["https://github.com/acme/app/pull/10", "The stack around #10 in acme/app."],
      ["https://github.com/acme/app/pull/10/files?w=1", "The stack around #10 in acme/app."],
      ["acme/app#10", "The stack around #10 in acme/app."],
      ["acme/app:feature/cache", "The stack around the PR for feature/cache in acme/app."],
      ["acme/app#9,10,11", "The chain #9 → #10 → #11 in acme/app."],
    ];
    for (const [raw, text] of cases) expect(inputHint(raw)).toMatchObject({ ok: true, text });
  });

  it("turns away what the server can't review yet, or can't read", () => {
    expect(inputHint("acme/app@main...b4")).toEqual({
      ok: false,
      text: "Strata cannot read commit ranges at this time. Type a PR or a branch.",
    });
    expect(inputHint("PR 10")).toEqual({
      ok: false,
      text: "Type a PR URL, owner/repo#123 or owner/repo:branch.",
    });
    expect(inputHint("acme/app#3,3")).toMatchObject({ ok: false });
  });
});

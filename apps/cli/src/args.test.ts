import { describe, expect, it } from "vitest";
import { parseCommand, UsageError } from "./args.js";

describe("parseCommand", () => {
  it("shows help with no arguments or -h", () => {
    expect(parseCommand([])).toEqual({ kind: "help" });
    expect(parseCommand(["analyze", "a/b#1", "-h"])).toEqual({ kind: "help" });
  });

  it("parses analyze with its options", () => {
    expect(
      parseCommand([
        "analyze",
        "main...feature",
        "--repo-path",
        "../x",
        "--source",
        "spec.md",
        "--source",
        "ticket.md",
        "--json",
        "r.json",
      ]),
    ).toEqual({
      kind: "analyze",
      input: "main...feature",
      repoPath: "../x",
      sources: ["spec.md", "ticket.md"],
      out: "strata-report.html",
      json: "r.json",
    });
  });

  it("rejects unknown commands, flags and extra arguments", () => {
    expect(() => parseCommand(["review", "a/b#1"])).toThrow(UsageError);
    expect(() => parseCommand(["analyze", "a/b#1", "--nope"])).toThrow(UsageError);
    expect(() => parseCommand(["analyze", "a/b#1", "extra"])).toThrow(UsageError);
    expect(() => parseCommand(["analyze"])).toThrow(/needs an <input>/);
  });
});

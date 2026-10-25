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

  it("takes the tip of a fork's path with --leaf", () => {
    expect(parseCommand(["analyze", "acme/app#5", "--leaf", "6"])).toMatchObject({ leaf: 6 });
    expect(() => parseCommand(["analyze", "acme/app#5", "--leaf", "six"])).toThrow(
      '--leaf needs a PR number, got "six".',
    );
    expect(() => parseCommand(["stacks", "acme/app", "--leaf", "6"])).toThrow(UsageError);
  });

  it("rejects unknown commands, flags and extra arguments", () => {
    expect(() => parseCommand(["review", "a/b#1"])).toThrow(UsageError);
    expect(() => parseCommand(["analyze", "a/b#1", "--nope"])).toThrow(UsageError);
    expect(() => parseCommand(["analyze", "a/b#1", "extra"])).toThrow(UsageError);
    expect(() => parseCommand(["analyze"])).toThrow(/needs an <input>/);
  });

  it("parses stacks with a checkout and JSON output", () => {
    expect(
      parseCommand(["stacks", "acme/app", "--repo-path", "~/w/app", "--json", "s.json"]),
    ).toEqual({ kind: "stacks", repo: "acme/app", repoPath: "~/w/app", json: "s.json" });
    expect(parseCommand(["stacks", "acme/app"])).toEqual({ kind: "stacks", repo: "acme/app" });
  });

  it("rejects stacks without an owner/repo, or with analyze-only flags", () => {
    expect(() => parseCommand(["stacks"])).toThrow(/needs an <owner\/repo>/);
    expect(() => parseCommand(["stacks", "acme/app#12"])).toThrow(/owner\/repo/);
    expect(() => parseCommand(["stacks", "acme/app", "--out", "x.html"])).toThrow(UsageError);
  });
});

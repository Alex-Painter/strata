import { describe, expect, it } from "vitest";
import { ChangeInputError, describeInput, parseChangeInput } from "./input.js";

const repo = { kind: "github", owner: "GlyphicAI", name: "maverick-backend" };

describe("parseChangeInput", () => {
  it.each([
    ["GlyphicAI/maverick-backend#6938", { kind: "stack-of", repo, seed: { pr: 6938 } }],
    [
      "https://github.com/GlyphicAI/maverick-backend/pull/6938/files",
      { kind: "stack-of", repo, seed: { pr: 6938 } },
    ],
    [
      "GlyphicAI/maverick-backend:feed-forecast/model",
      { kind: "stack-of", repo, seed: { branch: "feed-forecast/model" } },
    ],
    ["GlyphicAI/maverick-backend#1, 2,3", { kind: "stack", repo, numbers: [1, 2, 3] }],
    [
      "GlyphicAI/maverick-backend@main...feature/x",
      { kind: "range", repo, base: "main", head: "feature/x" },
    ],
  ])("%s", (raw, expected) => {
    expect(parseChangeInput(raw)).toEqual(expected);
  });

  it("only accepts bare ranges with a local checkout", () => {
    expect(() => parseChangeInput("main...HEAD")).toThrow(ChangeInputError);
    expect(parseChangeInput("main..HEAD", { localRepoPath: "/r" })).toEqual({
      kind: "range",
      repo: { kind: "local", path: "/r" },
      base: "main",
      head: "HEAD",
    });
  });

  it("rejects duplicate PRs in a stack", () => {
    expect(() => parseChangeInput("a/b#1,1")).toThrow(/more than once/);
  });

  it("describes inputs back in the same syntax", () => {
    expect(describeInput(parseChangeInput("a/b#1,2"))).toBe("a/b#1,2");
    expect(describeInput(parseChangeInput("a/b#7"))).toBe("a/b#7");
    expect(describeInput(parseChangeInput("a/b:x/y"))).toBe("a/b:x/y");
    expect(
      describeInput({
        kind: "stack-of",
        repo: { kind: "github", owner: "a", name: "b" },
        seed: { pr: 7, leaf: 9 },
      }),
    ).toBe("a/b#7 up to #9");
    expect(describeInput(parseChangeInput("a/b@main...x"))).toBe("a/b@main...x");
  });
});

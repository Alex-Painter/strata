import type { Stack, StackNode, StackPr } from "@strata/core";
import { describe, expect, it } from "vitest";
import { formatStacks } from "./stacks.js";

function node(
  number: number,
  parent: number | null,
  children: number[],
  fields: Partial<StackPr> = {},
): StackNode {
  return {
    pr: {
      number,
      title: `PR ${number}`,
      url: `https://github.com/acme/app/pull/${number}`,
      author: "dev",
      state: "open",
      draft: false,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      mergedAt: null,
      closedAt: null,
      baseRef: parent ? `b${parent}` : "main",
      headRef: `b${number}`,
      headOid: `${number}`.repeat(40).slice(0, 40),
      crossRepository: false,
      mergeCommitOid: null,
      baseOid: null,
      baseChanges: [],
      forcePushes: [],
      review: null,
      checks: null,
      ...fields,
    },
    parent,
    children,
    depth: 0,
    anchor: null,
  };
}

const stack: Stack = {
  id: "stk_1",
  repo: "acme/app",
  trunk: { name: "main", isDefault: true },
  root: 1,
  base: "abcdef1234567890abcdef1234567890abcdef12",
  nodes: [
    node(1, null, [2], { state: "merged" }),
    node(2, 1, [3, 4]),
    node(3, 2, [5], { draft: true }),
    node(5, 3, []),
    node(4, 2, []),
  ],
  edges: [
    { parent: 1, child: 2, via: "retarget", ref: "b1", link: "intact", evidence: [] },
    { parent: 2, child: 3, via: "base-ref", ref: "b2", link: "intact", evidence: [] },
    { parent: 3, child: 5, via: "base-ref", ref: "b3", link: "intact", evidence: [] },
    { parent: 2, child: 4, via: "base-ref", ref: "b2", link: "behind", evidence: [] },
  ],
  paths: [
    [1, 2, 3, 5],
    [1, 2, 4],
  ],
  selectedPath: [1, 2, 3, 5],
  seed: 1,
  issues: [
    {
      kind: "needs-restack",
      prs: [4],
      message: "#2 has commits that #4 doesn't. #4 needs a restack.",
      evidence: [],
    },
  ],
  notes: [],
};

describe("formatStacks", () => {
  it("draws each stack as a tree, bottom PR first, with links and issues", () => {
    expect(formatStacks("acme/app", [stack])).toBe(
      [
        "acme/app: 1 stack",
        "",
        "#1 PR 1 [merged]  left main at abcdef1",
        "└─ #2 PR 2 [open]  intact, retargeted",
        "   ├─ #3 PR 3 [draft]  intact",
        "   │  └─ #5 PR 5 [open]  intact",
        "   └─ #4 PR 4 [open]  behind",
        "  ! #2 has commits that #4 doesn't. #4 needs a restack.",
        "",
      ].join("\n"),
    );
  });

  it("says when there are none", () => {
    expect(formatStacks("acme/app", [])).toMatch(/no stacks/);
  });
});

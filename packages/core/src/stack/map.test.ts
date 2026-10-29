import { describe, expect, it } from "vitest";
import type { StackPrSummary } from "../model/api.js";
import type { LinkState } from "../model/stack.js";
import { layoutStackMap, stackMermaid } from "./map.js";

function pr(
  number: number,
  parent: number | null,
  fields: Partial<StackPrSummary> = {},
): StackPrSummary {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    author: "dev",
    state: "open",
    draft: false,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    mergedAt: null,
    baseRef: parent === null ? "main" : `b${parent}`,
    headRef: `b${number}`,
    mergeCommitOid: null,
    parent,
    link: parent === null ? null : "intact",
    linkEvidence: [],
    review: null,
    checks: null,
    ...fields,
  };
}

const linked = (number: number, parent: number, link: LinkState) => pr(number, parent, { link });

/** The map as text, top row first: each PR at its lane. */
function picture(prs: StackPrSummary[]): string[] {
  const layout = layoutStackMap({ prs });
  return layout.nodes.map((node) => `${"  ".repeat(node.lane)}#${node.pr}`);
}

describe("layoutStackMap", () => {
  it("puts a chain in one lane, tip on top, trunk below", () => {
    const layout = layoutStackMap({ prs: [pr(1, null), pr(2, 1), pr(3, 2)] });
    expect(layout.nodes).toEqual([
      { pr: 3, row: 0, lane: 0 },
      { pr: 2, row: 1, lane: 0 },
      { pr: 1, row: 2, lane: 0 },
    ]);
    expect(layout.trunkRow).toBe(3);
    expect(layout.lanes).toBe(1);
    expect(layout.edges).toEqual([
      { parent: null, child: 1, from: { row: 3, lane: 0 }, to: { row: 2, lane: 0 }, line: "solid" },
      { parent: 1, child: 2, from: { row: 2, lane: 0 }, to: { row: 1, lane: 0 }, line: "solid" },
      { parent: 2, child: 3, from: { row: 1, lane: 0 }, to: { row: 0, lane: 0 }, line: "solid" },
    ]);
  });

  it("opens a lane for each extra child of a fork", () => {
    expect(picture([pr(5, null), pr(6, 5), pr(7, 5)])).toEqual(["  #7", "#6", "#5"]);
  });

  it("keeps each subtree's rows together, so no edge passes through a PR", () => {
    // 1 → 2 → {3 → 4, 5 → {6, 7}}, and 1 → 8.
    const prs = [pr(1, null), pr(2, 1), pr(3, 2), pr(4, 3), pr(5, 2), pr(6, 5), pr(7, 5), pr(8, 1)];
    expect(picture(prs)).toEqual(["      #8", "    #7", "  #6", "  #5", "#4", "#3", "#2", "#1"]);

    const layout = layoutStackMap({ prs });
    for (const edge of layout.edges) {
      // An edge leaves its parent's row, turns into the child's lane and runs
      // straight up from there. Nothing else may sit in that lane on the way.
      const crossed = layout.nodes.filter(
        (node) =>
          node.pr !== edge.child &&
          node.lane === edge.to.lane &&
          node.row > edge.to.row &&
          node.row < edge.from.row,
      );
      expect(crossed, `edge to #${edge.child}`).toEqual([]);
    }
  });

  it("orders siblings by PR number, whatever order they arrive in", () => {
    expect(picture([pr(5, null), pr(7, 5), pr(6, 5)])).toEqual(
      picture([pr(5, null), pr(6, 5), pr(7, 5)]),
    );
  });

  it("dashes edges that need a restack and dots the ones git couldn't read", () => {
    const layout = layoutStackMap({
      prs: [pr(1, null), linked(2, 1, "behind"), linked(3, 2, "stale"), linked(4, 3, "unknown")],
    });
    expect(layout.edges.map((edge) => [edge.child, edge.line])).toEqual([
      [1, "solid"],
      [2, "dashed"],
      [3, "dashed"],
      [4, "dotted"],
    ]);
  });

  it("draws merged and re-anchored links as solid", () => {
    const layout = layoutStackMap({
      prs: [
        pr(1, null, { state: "merged" }),
        linked(2, 1, "re-anchored"),
        linked(3, 2, "merged-into-parent"),
      ],
    });
    expect(layout.edges.every((edge) => edge.line === "solid")).toBe(true);
  });

  it("draws a merged or closed PR's restack link as solid, since it can't be restacked", () => {
    const layout = layoutStackMap({
      prs: [
        pr(1, null, { state: "merged" }),
        pr(2, 1, { link: "behind", state: "merged" }),
        pr(3, 2, { link: "stale", state: "closed" }),
      ],
    });
    expect(layout.edges.every((edge) => edge.line === "solid")).toBe(true);
  });

  it("hangs a PR whose parent isn't listed off the trunk, in its own lane", () => {
    const layout = layoutStackMap({ prs: [pr(1, null), pr(2, 1), pr(9, 4)] });
    expect(layout.edges.find((edge) => edge.child === 9)).toMatchObject({
      parent: null,
      from: { row: 3, lane: 0 },
      to: { lane: 1 },
    });
    expect(layout.lanes).toBe(2);
  });
});

describe("stackMermaid", () => {
  it("draws the stack bottom to top with links to each PR", () => {
    const text = stackMermaid({
      trunk: "main",
      prs: [
        pr(1, null, { state: "merged", title: "Add the forecast model" }),
        linked(2, 1, "re-anchored"),
        linked(3, 2, "behind"),
        pr(4, 2, { draft: true }),
      ],
    });
    expect(text).toBe(
      [
        "flowchart BT",
        '  trunk["main"]',
        '  pr1["#35;1 Add the forecast model<br/>merged"]',
        '  pr2["#35;2 PR 2<br/>open"]',
        '  pr3["#35;3 PR 3<br/>open"]',
        '  pr4["#35;4 PR 4<br/>draft"]',
        "  trunk --> pr1",
        "  pr1 --> pr2",
        "  pr2 -.->|needs restack| pr3",
        "  pr2 --> pr4",
        '  click pr1 "https://github.com/acme/app/pull/1"',
        '  click pr2 "https://github.com/acme/app/pull/2"',
        '  click pr3 "https://github.com/acme/app/pull/3"',
        '  click pr4 "https://github.com/acme/app/pull/4"',
        "  classDef landed fill:#f4f4f6,stroke:#9a9aa6,color:#6b6b76",
        "  class pr1 landed",
        "",
      ].join("\n"),
    );
  });

  it("escapes titles so they can't break out of the label", () => {
    const text = stackMermaid({
      trunk: "main",
      prs: [pr(1, null, { title: 'Use "quotes" <b>, #9; and\nnewlines' })],
    });
    expect(text).toContain(
      'pr1["#35;1 Use #quot;quotes#quot; #lt;b#gt;, #35;9; and newlines<br/>open"]',
    );
  });
});

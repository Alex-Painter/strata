import type { StackPrSummary, StackSummary } from "@strata/core/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PathPicker } from "./PathPicker";
import { StackMap } from "./StackMap";

function pr(number: number, parent: number | null, fields: Partial<StackPrSummary> = {}) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    author: "dev",
    state: "open",
    draft: false,
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
  } satisfies StackPrSummary;
}

const MERGED = "5".repeat(40);

/** The demo repo's two shapes: a chain whose bottom PR landed, and a fork. */
const chain: StackSummary = {
  id: "stk_1",
  repo: "acme/app",
  trunk: "main",
  base: "a".repeat(40),
  root: 1,
  prs: [
    pr(1, null, { state: "merged", mergeCommitOid: MERGED }),
    pr(2, 1, { link: "re-anchored" }),
    pr(3, 2, { link: "behind" }),
  ],
  paths: [[1, 2, 3]],
  defaultPath: [1, 2, 3],
  issues: [],
  updatedAt: "2026-10-01T00:00:00Z",
};

const fork: StackSummary = {
  ...chain,
  id: "stk_5",
  root: 5,
  prs: [pr(5, null), pr(6, 5), pr(7, 5)],
  paths: [
    [5, 6],
    [5, 7],
  ],
  defaultPath: [5, 7],
};

function render(element: React.ReactElement): HTMLElement {
  document.body.innerHTML = renderToStaticMarkup(element);
  return document.body;
}

describe("StackMap", () => {
  it("draws tips on top and the trunk at the bottom, where the stack left it", () => {
    const page = render(<StackMap stack={chain} />);
    const rows = [...page.querySelectorAll("ol[aria-label='Stack map'] > li")];
    expect(
      rows.map((row) => row.getAttribute("data-pr") ?? row.getAttribute("data-trunk")),
    ).toEqual(["3", "2", "1", "main"]);
    expect(rows[3]?.textContent).toContain("left at aaaaaaa");
  });

  it("links every PR to GitHub, and a merged one to the commit it landed as", () => {
    const page = render(<StackMap stack={chain} />);
    for (const { number, url } of chain.prs) {
      const row = page.querySelector(`li[data-pr='${number}']`);
      expect(row?.querySelector(`a[href='${url}']`)?.textContent).toBe(`#${number}`);
    }
    const landed = page.querySelector("li[data-pr='1'] a[title='The commit that GitHub merged']");
    expect(landed?.getAttribute("href")).toBe(`https://github.com/acme/app/commit/${MERGED}`);
    expect(landed?.textContent).toBe("as 5555555");
  });

  it("dashes the edge into a PR that needs a restack, and says so on the PR", () => {
    const page = render(<StackMap stack={chain} />);
    const edges = [...page.querySelectorAll("path[data-edge]")].map((path) => [
      path.getAttribute("data-edge"),
      path.getAttribute("data-line"),
    ]);
    expect(edges).toEqual([
      ["trunk-1", "solid"],
      ["1-2", "solid"],
      ["2-3", "dashed"],
    ]);
    expect(page.querySelector("li[data-pr='3']")?.textContent).toContain(
      "Behind #2: needs a restack",
    );
    expect(page.querySelector("li[data-pr='2']")?.textContent).toContain("Now on b1");
  });

  it("puts a fork's second branch in its own lane and dims PRs off the path", () => {
    const page = render(<StackMap stack={fork} path={[5, 7]} />);
    const lanes = [...page.querySelectorAll("li[data-pr]")].map((row) => [
      row.getAttribute("data-pr"),
      row.getAttribute("data-lane"),
    ]);
    expect(lanes).toEqual([
      ["7", "1"],
      ["6", "0"],
      ["5", "0"],
    ]);
    const dimmed = (n: number) =>
      page.querySelector(`li[data-pr='${n}'] > div`)?.className.includes("opacity-50");
    expect([dimmed(5), dimmed(6), dimmed(7)]).toEqual([false, true, false]);
  });

  it("offers each PR as a scope only when the map is the rail", () => {
    expect(render(<StackMap stack={chain} />).querySelectorAll("button")).toHaveLength(0);
    const rail = render(<StackMap stack={chain} active={2} onSelect={() => {}} />);
    const buttons = [...rail.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Show #3 PR 3",
      "Show #2 PR 2",
      "Show #1 PR 1",
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-current"))).toEqual([null, "true", null]);
  });
});

describe("PathPicker", () => {
  it("lists one choice per path of a fork, with the current one pressed", () => {
    const page = render(<PathPicker stack={fork} current={[5, 7]} onPick={() => {}} />);
    const choices = [...page.querySelectorAll("button")];
    expect(choices.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["#5 → #6PR 6", "false"],
      ["#5 → #7PR 7", "true"],
    ]);
  });

  it("shows nothing for a stack with one path", () => {
    expect(render(<PathPicker stack={chain} current={[1, 2, 3]} />).innerHTML).toBe("");
  });
});

import type { StackPrSummary, StackSummary } from "@strata/core/model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { StackRail } from "./StackRail";

const pr = (number: number, parent: number | null) =>
  ({
    number,
    title: `PR ${number}`,
    headRef: `feat/pr-${number}`,
    parent,
  }) as unknown as StackPrSummary;
// #5 forks into #6 and #7.
const stack = {
  id: "s",
  repo: "acme/app",
  trunk: "main",
  base: null,
  root: 5,
  prs: [pr(5, null), pr(6, 5), pr(7, 5)],
  paths: [
    [5, 6],
    [5, 7],
  ],
  defaultPath: [5, 7],
  issues: [],
  updatedAt: "2026-10-01T00:00:00Z",
} as unknown as StackSummary;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

it("draws every PR, dims the other branch, and opens its path when chosen", () => {
  const scoped: (number | null)[] = [];
  const picked: number[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <StackRail
        stack={stack}
        path={[5, 6]}
        pr={null}
        onScope={(n) => scoped.push(n)}
        onPickPath={(tip) => picked.push(tip)}
        pickingPath={null}
      />,
    ),
  );
  const row = (n: number) =>
    container.querySelector(`li[data-pr="${n}"] button`) as HTMLButtonElement;
  expect(
    [...container.querySelectorAll("li[data-pr]")].map((li) => li.getAttribute("data-pr")),
  ).toEqual(expect.arrayContaining(["5", "6", "7"]));
  expect(container.querySelector("li[data-trunk]")?.textContent).toBe("main");
  expect(row(7).className).toContain("faint");
  expect(row(6).className).not.toContain("faint");
  expect(container.querySelector("[data-yours]")).toBeNull();
  // Each PR shows its branch under its title.
  expect(row(6).textContent).toContain("feat/pr-6");
  expect(container.querySelectorAll("path[data-edge]")).toHaveLength(3);

  act(() => row(6).click());
  act(() => row(7).click());
  expect(scoped).toEqual([6]);
  expect(picked).toEqual([7]);
});

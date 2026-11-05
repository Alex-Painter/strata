import type { PathPr } from "@strata/core/model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { PendingOverview } from "./PendingOverview";

const pr = (number: number, extra: Partial<PathPr> = {}): PathPr => ({
  number,
  author: "dana",
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  state: "open",
  draft: false,
  review: "review-required",
  checks: "success",
  ...extra,
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

function render(prs: PathPr[]) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<PendingOverview title="Add forecasts" repo="acme/app" prs={prs} />));
  return container;
}

it("shows each PR's GitHub facts, tip first, before there is a report", () => {
  const container = render([
    pr(5, {
      title: "Add the model",
      url: "https://github.com/acme/app/pull/5",
      baseRef: "main",
      headRef: "feat/model",
    }),
    pr(6, { title: "Add the API", baseRef: "feat/model", headRef: "feat/api", draft: true }),
  ]);
  expect(container.querySelector("h1")?.textContent).toBe("Add forecasts");
  expect(container.textContent).toContain("2 PRs: 2 open");
  expect(
    [...container.querySelectorAll("li[data-pr]")].map((li) => li.getAttribute("data-pr")),
  ).toEqual(["6", "5"]);
  expect(container.querySelector("li[data-trunk]")?.textContent).toBe("main");

  const row = (n: number) => container.querySelector(`li[data-pr="${n}"] a`) as HTMLAnchorElement;
  expect(row(5).href).toBe("https://github.com/acme/app/pull/5");
  expect(row(5).target).toBe("_blank");
  // Without a stored URL, the link comes from the repo.
  expect(row(6).href).toBe("https://github.com/acme/app/pull/6");
  expect(row(6).textContent).toContain("Add the API");
  expect(row(6).textContent).toContain("feat/api → feat/model");
  expect(row(6).textContent).toContain("Draft");
  expect(row(6).textContent).toContain("Review required · Checks pass");
  expect(row(6).textContent).toContain("dana · opened 3h ago");
});

it("shows the number when a Change saved before Strata kept titles has none", () => {
  const container = render([pr(9)]);
  expect(container.querySelector('li[data-pr="9"]')?.textContent).toContain("#9");
  expect(container.querySelector("li[data-trunk]")).toBeNull();
});

it("shows nothing without PRs", () => {
  const container = render([]);
  expect(container.textContent).toBe("");
});

import type { ChangeSummary } from "@strata/core/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewedPage } from "./ReviewedPage";

const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const change = (id: string, seenDaysAgo: number, fields: Partial<ChangeSummary> = {}) =>
  ({
    id,
    title: `Change ${id}`,
    repo: "acme/app",
    input: `acme/app#${id}`,
    status: "done",
    origin: "assigned",
    yours: [
      {
        number: Number(id),
        reasons: [{ kind: "reviewed" }],
        active: true,
        seenAt: ago(seenDaysAgo),
      },
    ],
    waiting: false,
    rootPr: Number(id),
    tipPr: Number(id),
    prs: [],
    createdAt: ago(30),
    updatedAt: ago(30),
    ...fields,
  }) as ChangeSummary;
const list = [change("6", 2), change("7", 20), change("8", 1, { waiting: true })];
const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      if (url === "/api/changes") return Response.json(list);
      return Response.json({ error: "Not found." }, { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

it("lists the stacks you reviewed in the last 14 days, and the older ones on request", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ReviewedPage me={{ login: "alex", name: null, avatarUrl: null }} />
      </QueryClientProvider>,
    ),
  );
  await flush();
  const shown = () =>
    [...container.querySelectorAll("tbody tr a:first-child")]
      .map((a) => a.getAttribute("href"))
      .filter((href) => href?.startsWith("/changes/"));
  expect(asked).toEqual(["/api/changes"]);
  expect(shown()).toEqual(["/changes/6"]);
  expect(container.querySelector('a[href="/reviewed"]')?.getAttribute("aria-current")).toBe("page");

  const more = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Show 1 older",
  ) as HTMLButtonElement;
  act(() => more.click());
  expect(shown()).toEqual(["/changes/6", "/changes/7"]);
  act(() => root.unmount());
});

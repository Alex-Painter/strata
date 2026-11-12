import type { UsageResponse } from "@strata/core/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UsagePage } from "./UsagePage";

const totals = (costUsd: number, requests = 1, cached = 0) => ({
  requests,
  cached,
  inputTokens: 12_000,
  outputTokens: 800,
  costUsd,
  unpriced: 0,
});
const today = new Date().toISOString().slice(0, 10);

const usage = (days: number): UsageResponse => ({
  since: "2026-10-14T00:00:00.000Z",
  days,
  total: totals(1.5, 3, 2),
  byTask: [
    { task: "whole-summary", models: ["claude-sonnet-5-5"], ...totals(1.2) },
    { task: "layers", models: ["claude-haiku-5-5"], ...totals(0.3, 2, 2) },
  ],
  byModel: [],
  byDay: [{ day: today, costByTask: { "whole-summary": 1.2, layers: 0.3 }, ...totals(1.5, 3, 2) }],
  byChange: [
    { changeId: "chg_1", repo: "acme/app", title: "Add billing", ...totals(1.4) },
    { changeId: null, repo: null, title: null, ...totals(0.1) },
  ],
  billed: { costUsd: 1.62, scope: "key" },
  billedError: null,
});

const asked: string[] = [];
beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      if (url.startsWith("/api/usage")) {
        return Response.json(usage(Number(new URL(url, "http://x").searchParams.get("days"))));
      }
      return Response.json([]);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

async function render() {
  const container = document.createElement("div");
  document.body.append(container);
  act(() =>
    createRoot(container).render(
      <QueryClientProvider client={new QueryClient()}>
        <UsagePage me={{ login: "alex", name: null, avatarUrl: null }} />
      </QueryClientProvider>,
    ),
  );
  await flush();
  await flush();
  return container;
}

it("shows the cost by feature and by Change, and the billed amount", async () => {
  const page = await render();
  expect(asked).toContain("/api/usage?days=30");
  const text = page.textContent ?? "";
  expect(text).toContain("Estimated cost$1.50");
  expect(text).toContain("Billed by Anthropic$1.62");
  expect(text).toContain("Answers from the cache2");
  const features = [...page.querySelectorAll("section[aria-labelledby='feature-h'] tbody tr")];
  expect(features.map((row) => row.querySelector("td")?.textContent)).toEqual([
    "Whole-stack summary and Guide",
    "Layers",
  ]);
  expect(features[0]?.textContent).toContain("80%");
  const change = page.querySelector("a[href='/changes/chg_1']");
  expect(change?.textContent).toContain("Add billing");
  expect(text).toContain("No Change recorded");
  const bar = page.querySelector(`li[title^='${today}']`);
  expect(bar?.getAttribute("title")).toBe(
    `${today}: $1.50 (Whole-stack summary and Guide $1.20, Layers $0.30)`,
  );
});

it("asks again for the period that you select", async () => {
  const page = await render();
  const seven = [...page.querySelectorAll("button")].find((b) => b.textContent === "7 days");
  expect(seven?.getAttribute("aria-pressed")).toBe("false");
  act(() => seven?.click());
  await flush();
  expect(asked).toContain("/api/usage?days=7");
  expect(seven?.getAttribute("aria-pressed")).toBe("true");
});

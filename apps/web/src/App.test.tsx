import {
  buildDiff,
  createClassifier,
  guideGroups,
  REPORT_SCHEMA_VERSION,
  ruleGuide,
} from "@strata/core";
import type { ChangeDetail, ChangeReport, Stack, StackPr } from "@strata/core/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";

const whole = buildDiff(
  "diff --git a/app.py b/app.py\nnew file mode 100644\n--- /dev/null\n+++ b/app.py\n@@ -0,0 +1 @@\n+x = 1\n",
  { classifier: createClassifier() },
);
const base = "a".repeat(40);
const head = "b".repeat(40);
const pr = (number: number, parent: number | null): StackPr => ({
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
  baseRef: parent === null ? "main" : `b${parent}`,
  headRef: `b${number}`,
  headOid: head,
  crossRepository: false,
  mergeCommitOid: null,
  baseOid: null,
  baseChanges: [],
  forcePushes: [],
  review: null,
  checks: null,
});
// #5 forks into #6, #7 and #8; each Change is one path.
const stackFor = (path: number[]): Stack => ({
  id: "stk_5",
  repo: "acme/app",
  trunk: { name: "main", isDefault: true },
  root: 5,
  base,
  nodes: [
    { pr: pr(5, null), parent: null, children: [6, 7, 8], depth: 0, anchor: base },
    ...[6, 7, 8].map((n) => ({ pr: pr(n, 5), parent: 5, children: [], depth: 1, anchor: head })),
  ],
  edges: [],
  paths: [
    [5, 6],
    [5, 7],
    [5, 8],
  ],
  selectedPath: path,
  seed: 5,
  issues: [],
  notes: [],
});
const detail = (id: string, tip: number): ChangeDetail => ({
  change: {
    id,
    title: `Change ${id}`,
    repo: "acme/app",
    input: "acme/app#5",
    status: null,
    origin: "added",
    yours: [],
    waiting: false,
    rootPr: 5,
    tipPr: tip,
    prs: [],
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  },
  run: null,
  report: {
    schemaVersion: REPORT_SCHEMA_VERSION,
    change: {
      id,
      title: `Change ${id}`,
      repo: { kind: "github", owner: "acme", name: "app" },
      revisions: { base, head },
      files: whole.files,
      hunks: whole.hunks,
      layers: whole.layers,
      hints: [],
    },
    stack: stackFor([5, tip]),
    parts: [],
    sources: [],
    summary: [],
    guide: ruleGuide(guideGroups(whole)),
    layerSummaries: [],
    diagrams: [],
    notes: [],
    raw: { diff: "" },
    analysis: { engineVersion: "test", startedAt: "2026-10-02T00:00:00.000Z", durationMs: 1 },
  } as unknown as ChangeReport,
  sources: [],
});
const changes: Record<string, ChangeDetail> = { A: detail("A", 6), B: detail("B", 7) };

let opened = false;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/me") return Response.json({ login: "dev", name: null, avatarUrl: null });
      if (init?.method === "POST") {
        const { leaf } = JSON.parse(String(init.body)) as { leaf: number };
        if (leaf === 7) return Response.json(changes.B);
        return opened
          ? Response.json(detail("C", 8))
          : new Response(JSON.stringify({ pending: true, progress: null }), { status: 202 });
      }
      return Response.json(changes[url.split("/").pop() as string]);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it("forgets a path picked on one Change when the user goes back to another", async () => {
  window.history.replaceState(null, "", "/changes/A");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    ),
  );
  await wait(50);
  // A PR on another branch of the stack opens its path.
  const pick = (tip: number) =>
    container.querySelector(
      `ul[aria-label="Pull requests"] li[data-pr="${tip}"] button`,
    ) as HTMLButtonElement;

  act(() => pick(7).click());
  await wait(50);
  expect(window.location.pathname).toBe("/changes/B");

  // On B, the user picks #5 → #8 and goes back to A while the server reads.
  act(() => pick(8).click());
  await wait(50);
  expect(pick(8).textContent).toContain("Opening…");
  await act(async () => {
    window.history.back();
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(window.location.pathname).toBe("/changes/A");
  expect(container.textContent).not.toContain("Opening…");

  opened = true;
  await wait(3000);
  expect(window.location.pathname).toBe("/changes/A");
  act(() => root.unmount());
});

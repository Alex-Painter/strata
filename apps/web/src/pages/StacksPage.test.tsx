import { summarizeStack } from "@strata/core";
import type { Stack, StackPr } from "@strata/core/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route, Switch } from "wouter";
import { StacksPage } from "./StacksPage";

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
// #5 forks into #6 and #7.
const stack: Stack = {
  id: "stk_5",
  repo: "acme/app",
  trunk: { name: "main", isDefault: true },
  root: 5,
  base,
  nodes: [
    { pr: pr(5, null), parent: null, children: [6, 7], depth: 0, anchor: base },
    { pr: pr(6, 5), parent: 5, children: [], depth: 1, anchor: head },
    { pr: pr(7, 5), parent: 5, children: [], depth: 1, anchor: head },
  ],
  edges: [],
  paths: [
    [5, 6],
    [5, 7],
  ],
  selectedPath: [5, 6],
  seed: 5,
  issues: [],
  notes: [],
};

// #9 is stacked on #7 later, so the path to #7 then ends at #9.
const grown: Stack = {
  ...stack,
  nodes: [
    ...stack.nodes.map((node) => (node.pr.number === 7 ? { ...node, children: [9] } : node)),
    { pr: pr(9, 7), parent: 7, children: [], depth: 2, anchor: head },
  ],
  paths: [
    [5, 6],
    [5, 7, 9],
  ],
  selectedPath: [5, 7, 9],
};

let listed = stack;
let opened = false;
const leaves: number[] = [];
beforeEach(() => {
  listed = stack;
  opened = false;
  leaves.length = 0;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const { leaf } = JSON.parse(String(init.body)) as { leaf: number };
        leaves.push(leaf);
        return opened
          ? Response.json({ change: { id: `chg_${leaf}` }, run: null, report: null, sources: [] })
          : new Response(JSON.stringify({ pending: true, progress: null }), { status: 202 });
      }
      if (url.endsWith("/stacks")) {
        return Response.json({ repo: "acme/app", stacks: [summarizeStack(listed)] });
      }
      return new Response(null, { status: 404 });
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

function render(client = new QueryClient()) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <Switch>
          <Route path="/repos/:owner/:name">
            {() => <StacksPage me={{ login: "dev", name: null, avatarUrl: null }} />}
          </Route>
          <Route path="/changes/:id">{(params) => <p>{params.id}</p>}</Route>
        </Switch>
      </QueryClientProvider>,
    ),
  );
  const button = (text: RegExp) =>
    [...container.querySelectorAll("button")].find((b) =>
      text.test(b.textContent ?? ""),
    ) as HTMLButtonElement;
  return { root, button };
}

it("opens only the path the card shows when the path changes while opening", async () => {
  window.history.replaceState(null, "", "/repos/acme/app");
  const { root, button } = render();
  await wait(50);

  act(() => button(/PR 7/).click());
  act(() => button(/^Review/).click());
  await wait(50);
  expect(button(/Opening/)).toBeDefined();

  // While the server reads, the user goes back to #5 → #6.
  act(() => button(/PR 6/).click());
  opened = true;
  await wait(3000);
  expect(window.location.pathname).toBe("/repos/acme/app");
  expect(button(/^Review/).disabled).toBe(false);

  act(() => button(/^Review/).click());
  await wait(50);
  expect(window.location.pathname).toBe("/changes/chg_6");
  expect(leaves.at(-1)).toBe(6);
  act(() => root.unmount());
});

it("opens the path the card shows after the stack list changes under it", async () => {
  // The card mounts from the list it saw last, with #5 → #7 chosen.
  window.history.replaceState(null, "", "/repos/acme/app");
  const client = new QueryClient();
  client.setQueryData(["stacks", "acme/app"], {
    repo: "acme/app",
    stacks: [summarizeStack({ ...stack, selectedPath: [5, 7] })],
  });
  listed = grown;
  opened = true;
  const { root, button } = render(client);
  await wait(50);
  expect(button(/^Review/).textContent).toBe("Review 3 PRs");

  act(() => button(/^Review/).click());
  await wait(50);
  expect(leaves).toEqual([9]);
  act(() => root.unmount());
});

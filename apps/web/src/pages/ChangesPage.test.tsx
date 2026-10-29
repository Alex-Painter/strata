import type {
  AssignedStatus,
  ChangeSummary,
  StackPrSummary,
  StackSummary,
} from "@strata/core/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChangesPage } from "./ChangesPage";

const change = (id: string, fields: Partial<ChangeSummary>): ChangeSummary => ({
  id,
  title: `Change ${id}`,
  repo: "acme/app",
  input: `acme/app#${id}`,
  status: "done",
  origin: "added",
  yours: [],
  waiting: false,
  rootPr: Number(id),
  tipPr: Number(id),
  prs: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...fields,
});
const seenAt = "2026-10-01T00:00:00Z";
const list: ChangeSummary[] = [
  change("3", {
    origin: "assigned",
    waiting: true,
    rootPr: 2,
    prs: [2, 3].map((number) => ({
      number,
      author: "sam",
      createdAt: seenAt,
      state: "open" as const,
      draft: false,
      review: null,
      checks: null,
    })),
    yours: [
      {
        number: 3,
        reasons: [{ kind: "review-requested", direct: false, teams: ["acme/backend"] }],
        active: true,
        seenAt,
      },
    ],
  }),
  // Opened by hand from #20's stack.
  change("20", { rootPr: 20, tipPr: 21 }),
  change("6", {
    origin: "assigned",
    yours: [{ number: 6, reasons: [{ kind: "reviewed" }], active: true, seenAt }],
  }),
  // The search made #2 → #4 before #3's review moved to a longer path.
  change("8", { origin: "assigned", rootPr: 2, tipPr: 4 }),
];
const pr = (number: number, fields: Partial<StackPrSummary> = {}) =>
  ({ number, title: `PR ${number}`, author: "sam", state: "open", ...fields }) as StackPrSummary;
const stack = (root: number, prs: StackPrSummary[]) =>
  ({
    id: `s${root}`,
    repo: "acme/app",
    root,
    prs,
    defaultPath: prs.map((pr) => pr.number),
    updatedAt: seenAt,
  }) as unknown as StackSummary;
const stacks = {
  repo: "acme/app",
  readAt: seenAt,
  refreshing: true,
  stacks: [
    // #2-#3 is yours (waiting), #5-#6 too (reviewed): neither is listed again.
    stack(2, [pr(2), pr(3)]),
    stack(5, [pr(5), pr(6)]),
    stack(20, [pr(20), pr(21)]),
    stack(30, [pr(30, { author: "kim" }), pr(31)]),
    // All merged: not open, so not listed.
    stack(40, [pr(40, { state: "merged" }), pr(41, { state: "merged" })]),
  ],
};
let status: AssignedStatus;
const posts: string[] = [];

beforeEach(() => {
  status = {
    repos: ["acme/app"],
    running: false,
    progress: null,
    lastFinishedAt: null,
    errors: ["acme/app#9: no luck"],
  };
  posts.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(url);
        status = { ...status, running: true, progress: "Searching acme/app" };
        return Response.json(status, { status: 202 });
      }
      if (url === "/api/assigned") return Response.json(status);
      if (url === "/api/changes") return Response.json(list);
      if (url === "/api/repos/acme/app/stacks") return Response.json(stacks);
      return Response.json({ error: "Not found." }, { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

it("splits Changes by what they ask of you, lists the repo's other stacks, and searches on request", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ChangesPage me={{ login: "alex", name: null, avatarUrl: null }} />
      </QueryClientProvider>,
    ),
  );
  await flush();
  await flush();

  const section = (heading: string) =>
    container.querySelector(`section[aria-labelledby="${heading}"]`) as HTMLElement;
  const rows = (heading: string) =>
    [...section(heading).querySelectorAll("tbody tr")].map((tr) => [
      tr.querySelector("a")?.getAttribute("href"),
      tr.textContent,
    ]);

  const waiting = section("waiting-h");
  expect(rows("waiting-h")).toHaveLength(1);
  expect(waiting.textContent).toContain("#3 review requested from acme/backend");
  expect(waiting.textContent).toContain("Needs your review");
  expect(waiting.querySelector('td[title="#3 is PR 2 of 2 in the stack."]')?.textContent).toBe(
    "2/2",
  );
  expect(waiting.textContent).toContain("acme/app#9: no luck");

  expect(rows("assigned-h").map(([href]) => href)).toEqual(["/changes/6", "/changes/8"]);
  expect(section("assigned-h").textContent).toContain("#6 reviewed by you");
  expect(section("assigned-h").textContent).toContain("acme/app#2 → #4");

  // #20's stack has a Change you opened, so it's listed there, not with the others.
  expect(rows("opened-h").map(([href]) => href)).toEqual(["/changes/20"]);
  const others = rows("others-acme-app");
  expect(others.map(([href]) => href)).toEqual(["/repos/acme/app#stack-30"]);
  expect(others[0]?.[1]).toContain("Not analysed");
  expect(others[0]?.[1]).toContain("kim, sam");
  expect(others[0]?.[1]).toContain("Needs review");
  expect(others[0]?.[1]).toContain("1/2");
  const github = section("others-acme-app").querySelector('a[aria-label="Open #30 on GitHub"]');
  expect(github?.getAttribute("href")).toBe("https://github.com/acme/app/pull/30");
  expect(github?.getAttribute("target")).toBe("_blank");
  expect(section("others-acme-app").textContent).toContain("Strata looks for changes");

  const refresh = [...waiting.querySelectorAll("button")].find(
    (b) => b.textContent === "Refresh",
  ) as HTMLButtonElement;
  act(() => refresh.click());
  await flush();
  expect(posts).toEqual(["/api/assigned/search"]);
  expect(waiting.textContent).toContain("Searching acme/app");
  act(() => root.unmount());
});

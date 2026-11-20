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
import { ChangesPage, ranges, requestedOf } from "./ChangesPage";

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
        reasons: [
          {
            kind: "review-requested",
            direct: false,
            teams: ["acme/backend"],
            requestedAt: "2026-10-01T09:30:00Z",
          },
        ],
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
    // Yours: listed under "Your PRs and stacks", not with the others.
    stack(50, [pr(50, { author: "alex" }), pr(51, { author: "alex" })]),
    // All merged: not open, so not listed.
    stack(40, [pr(40, { state: "merged" }), pr(41, { state: "merged" })]),
  ],
};
const mine = (number: number) => ({
  number,
  title: `My PR ${number}`,
  url: `https://github.com/acme/app/pull/${number}`,
  author: "alex",
  state: "open" as const,
  draft: number === 60,
  createdAt: seenAt,
  updatedAt: seenAt,
  review: null,
  checks: null,
});
// Newest first: #51 and #50 share a stack; #60 is alone.
const authored = { repo: "acme/app", viewer: "alex", prs: [mine(51), mine(60), mine(50)] };
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
      if (init?.method === "POST" && url === "/api/changes") {
        posts.push(`${url} ${init.body}`);
        return Response.json({ change: change("60", {}) }, { status: 201 });
      }
      if (init?.method === "POST") {
        posts.push(url);
        status = { ...status, running: true, progress: "Searching acme/app" };
        return Response.json(status, { status: 202 });
      }
      if (url === "/api/assigned") return Response.json(status);
      if (url === "/api/changes") return Response.json(list);
      if (url === "/api/repos/acme/app/stacks") return Response.json(stacks);
      if (url === "/api/repos/acme/app/authored") return Response.json(authored);
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
  // When your review was requested, next to when the PRs were opened.
  expect([...waiting.querySelectorAll("th")].map((th) => th.textContent)).toContain("Requested");
  const requested = waiting.querySelector('td[title^="#3: review requested"]');
  expect(requested?.textContent).toMatch(/ago$|\d{4}$/);
  expect(requested?.getAttribute("title")).toMatch(/^#3: review requested 1 Oct 2026, \d\d:\d\d$/);

  // Changes you reviewed before are on the Reviewed page, not here.
  expect(section("assigned-h")).toBeNull();
  expect(container.textContent).not.toContain("#6 reviewed by you");
  // Each PR number opens that PR on GitHub in a new tab, and does not open the Change.
  const numbers = [...waiting.querySelectorAll('a[title^="Open #"]')].filter((a) =>
    a.textContent?.startsWith("#"),
  );
  expect(numbers.map((a) => a.getAttribute("href"))).toEqual(
    expect.arrayContaining([
      "https://github.com/acme/app/pull/2",
      "https://github.com/acme/app/pull/3",
    ]),
  );
  expect(numbers.every((a) => a.getAttribute("target") === "_blank")).toBe(true);
  const before = location.pathname;
  // jsdom cannot open a tab: stop the link itself, and let the click reach the row.
  numbers[0]?.addEventListener("click", (event) => event.preventDefault());
  act(() => (numbers[0] as HTMLAnchorElement).click());
  expect(location.pathname).toBe(before);

  // #20's stack has a Change you added, so it's listed there, not with the others.
  expect(rows("added-h").map(([href]) => href)).toEqual(["/changes/20"]);

  // Your own PRs: #50 and #51 as one stack row, then #60 alone.
  const yours = rows("yours-h");
  expect(yours).toHaveLength(2);
  expect(yours[0]?.[0]).toBe("/repos/acme/app#stack-50");
  expect(yours[0]?.[1]).toContain("1–2/2");
  // The stack as bars, tip on top: both of #50's stack are yours.
  const glyph = section("yours-h").querySelector("tbody tr td:nth-child(3) [aria-hidden]");
  expect(glyph?.children).toHaveLength(2);
  expect(glyph?.querySelectorAll("[data-mine]")).toHaveLength(2);
  expect(yours[0]?.[1]).toContain("Not analysed");
  expect(yours[1]?.[1]).toContain("My PR 60");
  expect(yours[1]?.[1]).toContain("Draft");
  expect(section("yours-h").querySelector("tbody tr:last-child a")?.getAttribute("href")).toBe(
    "https://github.com/acme/app/pull/60",
  );
  // No review requests here, so no Requested column.
  expect(section("yours-h").textContent).not.toContain("Requested");
  const others = rows("others-acme-app");
  expect(others.map(([href]) => href)).toEqual(["/repos/acme/app#stack-30"]);
  expect(others[0]?.[1]).toContain("Not analysed");
  expect(others[0]?.[1]).toContain("kim, sam");
  expect(others[0]?.[1]).toContain("Needs review");
  expect(others[0]?.[1]).toContain("–/2");
  const github = section("others-acme-app").querySelector('a[aria-label="Open #30 on GitHub"]');
  expect(github?.getAttribute("href")).toBe("https://github.com/acme/app/pull/30");
  expect(github?.getAttribute("target")).toBe("_blank");
  expect(section("others-acme-app").textContent).toContain("Checking for updates");

  // #3 asks only acme/backend, one of your teams: the toggle hides it.
  const teams = [...waiting.querySelectorAll("label")]
    .find((l) => l.textContent?.startsWith("Show team requests"))
    ?.querySelector("input") as HTMLInputElement;
  expect(teams.checked).toBe(true);
  act(() => teams.click());
  expect(rows("waiting-h")).toHaveLength(0);
  expect(waiting.textContent).toContain("Show team requests (1 hidden)");
  act(() => teams.click());
  expect(rows("waiting-h")).toHaveLength(1);

  const refresh = [...waiting.querySelectorAll("button")].find(
    (b) => b.textContent === "Refresh",
  ) as HTMLButtonElement;
  act(() => refresh.click());
  await flush();
  expect(posts).toEqual(["/api/assigned/search"]);
  expect(waiting.textContent).toContain("Searching acme/app");

  // Selecting a lone PR of yours makes its Change.
  const lone = [...section("yours-h").querySelectorAll("tbody button")].find(
    (b) => b.textContent === "My PR 60",
  ) as HTMLButtonElement;
  act(() => lone.click());
  await flush();
  expect(posts).toContain('/api/changes {"input":"acme/app#60"}');
  act(() => root.unmount());
});

it("filters every list by PR number or by text", async () => {
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

  const box = container.querySelector('input[type="search"]') as HTMLInputElement;
  const type = (value: string) =>
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(box, value);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const shown = () =>
    [...container.querySelectorAll("tbody tr a:first-child")]
      .map((a) => a.getAttribute("href"))
      .filter((href) => href?.startsWith("/"));
  const section = (heading: string) =>
    container.querySelector(`section[aria-labelledby="${heading}"]`) as HTMLElement;

  // "/" puts the cursor in the box.
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  });
  expect(document.activeElement).toBe(box);

  // A number matches any PR in the row, with or without "#".
  type("#21");
  expect(shown()).toEqual(["/changes/20"]);
  expect(section("waiting-h").textContent).toContain("Nothing matches your search.");
  type("31");
  expect(shown()).toEqual(["/repos/acme/app#stack-30"]);

  // Text matches titles and authors, without regard to case.
  type("KIM");
  expect(shown()).toEqual(["/repos/acme/app#stack-30"]);
  type("change 20");
  expect(shown()).toEqual(["/changes/20"]);

  // Escape clears the search, and every row comes back.
  act(() => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(box.value).toBe("");
  expect(shown()).toContain("/changes/3");
  expect(shown()).toContain("/repos/acme/app#stack-30");
  act(() => root.unmount());
});

it("writes positions in the stack as runs", () => {
  expect(ranges([2, 3, 4, 5, 6, 7, 8, 9])).toBe("2–9");
  expect(ranges([1, 3, 4, 6])).toBe("1, 3–4, 6");
  expect(ranges([5])).toBe("5");
});

it("shows the oldest request that still waits on you, with each PR's time", () => {
  const asked = (requestedAt?: string) => ({
    kind: "review-requested" as const,
    direct: true,
    teams: [],
    ...(requestedAt ? { requestedAt } : {}),
  });
  const result = requestedOf(
    change("9", {
      yours: [
        { number: 9, reasons: [asked("2026-10-03T10:00:00Z")], active: true, seenAt },
        { number: 7, reasons: [asked("2026-10-02T10:00:00Z")], active: true, seenAt },
        // Merged or no longer asked: not counted.
        { number: 5, reasons: [asked("2026-09-01T10:00:00Z")], active: false, seenAt },
        // Reviewed, and asked only through a team since: it does not wait on you.
        {
          number: 4,
          reasons: [{ kind: "reviewed" }, { ...asked("2026-09-02T10:00:00Z"), direct: false }],
          active: true,
          seenAt,
        },
        { number: 8, reasons: [asked()], active: true, seenAt },
      ],
    }),
  );
  expect(result?.at).toBe("2026-10-02T10:00:00Z");
  expect(result?.detail.split("\n").map((line) => line.split(":")[0])).toEqual(["#7", "#9"]);
  expect(
    requestedOf(change("6", { yours: [{ number: 6, reasons: [asked()], active: true, seenAt }] })),
  ).toBeNull();
});

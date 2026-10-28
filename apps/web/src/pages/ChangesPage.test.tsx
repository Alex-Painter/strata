import type { AssignedStatus, ChangeSummary } from "@strata/core/model";
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
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...fields,
});
const seenAt = "2026-10-01T00:00:00Z";
const list: ChangeSummary[] = [
  change("3", {
    origin: "assigned",
    waiting: true,
    yours: [
      {
        number: 3,
        reasons: [{ kind: "review-requested", direct: false, teams: ["acme/backend"] }],
        active: true,
        seenAt,
      },
    ],
  }),
  change("4", {}),
  change("6", {
    origin: "assigned",
    yours: [{ number: 6, reasons: [{ kind: "assignee" }], active: false, seenAt }],
  }),
];
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
      return Response.json({ error: "Not found." }, { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

it("puts Changes waiting on you first, with your PRs and why, and searches on request", async () => {
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

  const waiting = container.querySelector('section[aria-labelledby="waiting-h"]') as HTMLElement;
  expect(waiting.textContent).toContain("Change 3");
  expect(waiting.textContent).toContain("#3 review requested from acme/backend");
  expect(waiting.textContent).toContain("acme/app#9: no luck");
  expect(waiting.textContent).not.toContain("Change 4");
  const earlier = container.querySelector("details") as HTMLElement;
  expect(earlier.textContent).toContain("Earlier assignments (1)");
  expect(earlier.textContent).toContain("#6 assigned");
  expect(container.textContent).toContain("Change 4");

  const refresh = [...waiting.querySelectorAll("button")].find(
    (b) => b.textContent === "Refresh",
  ) as HTMLButtonElement;
  act(() => refresh.click());
  await flush();
  expect(posts).toEqual(["/api/assigned/search"]);
  expect(waiting.textContent).toContain("Searching acme/app");
  act(() => root.unmount());
});

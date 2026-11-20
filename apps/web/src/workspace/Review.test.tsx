import type {
  ApprovalState,
  ApprovalsResponse,
  PrApproval,
  ReviewComment,
} from "@strata/core/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApprovalsView } from "./Approve";
import { ReviewBox } from "./Review";

const HEAD = "2".repeat(40);
const pr = (state: ApprovalState): PrApproval => ({
  number: 2,
  url: "https://github.com/acme/app/pull/2",
  analysedHead: HEAD,
  liveHead: HEAD,
  review: null,
  state,
});
const view = (state: ApprovalState, update?: (next: ApprovalsResponse) => void): ApprovalsView => ({
  data: { viewer: "alex", prs: [pr(state)] },
  error: null,
  sending: [],
  results: [],
  sendError: null,
  approve: () => {},
  ...(update ? { update } : {}),
});
const comment = (id: string, values: Partial<ReviewComment> = {}): ReviewComment => ({
  id,
  changeId: "chg_1",
  pr: 2,
  path: "src/a.ts",
  line: 3,
  side: "RIGHT",
  body: "Why?",
  messageId: "m1",
  commitOid: HEAD,
  state: "pending",
  url: null,
  createdAt: "",
  ...values,
});

let comments: ReviewComment[];
let reviews: unknown[];
beforeEach(() => {
  comments = [];
  reviews = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/changes/chg_1/comments") return Response.json(comments);
      if (url === "/api/changes/chg_1/review") {
        reviews.push(JSON.parse(String(init?.body)));
        comments = comments.map((c) => ({ ...c, state: "posted" }));
        return Response.json({
          url: "https://github.com/acme/app/pull/2#pullrequestreview-1",
          event: "COMMENT",
          posted: [],
          approvals: { viewer: "alex", prs: [pr({ kind: "can-approve" })] },
        });
      }
      if (url.startsWith("/api/comments/") && init?.method === "DELETE") {
        comments = comments.filter((c) => !url.endsWith(c.id));
        return new Response(null, { status: 204 });
      }
      return Response.json({ error: "Not found." }, { status: 404 });
    }),
  );
});
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
function mount(approvals: ApprovalsView) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <ReviewBox changeId="chg_1" pr={2} approvals={approvals} onReviewed={approvals.update} />
      </QueryClientProvider>,
    ),
  );
  return container;
}
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
function type(box: HTMLTextAreaElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    set?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("sends the summary and the pending comments as one review", async () => {
  comments = [
    comment("cmt_1"),
    comment("cmt_2", { path: null, line: null, body: "Add a note." }),
    comment("cmt_3", { pr: 3 }),
  ];
  const update = vi.fn();
  const container = mount(view({ kind: "can-approve" }, update));
  await flush();
  expect(container.textContent).toContain("2 comments");
  expect(container.textContent).toContain("a.ts:3");
  expect(container.textContent).toContain("On the PR");
  expect(container.textContent).not.toContain("cmt_3");
  const summary = container.querySelector(
    'textarea[aria-label="Review summary"]',
  ) as HTMLTextAreaElement;
  expect(summary.placeholder).toBe("Add review summary…");
  type(summary, "Looks close.");
  act(() => button("Only comment")?.click());
  await flush();
  expect(reviews).toEqual([
    {
      pr: 2,
      headOid: HEAD,
      event: "COMMENT",
      body: "Looks close.",
      commentIds: ["cmt_1", "cmt_2"],
    },
  ]);
  expect(update).toHaveBeenCalled();
  expect(container.textContent).toContain("Review sent to GitHub");
  expect(container.textContent).toContain("No comments yet");
});

it("opens only what GitHub takes, and needs text before a comment or a change request", async () => {
  const container = mount(view({ kind: "can-approve" }));
  await flush();
  expect(button("Only comment")?.disabled).toBe(true);
  expect(button("Request changes")?.disabled).toBe(true);
  expect(button("Approve")?.disabled).toBe(false);
  act(() => root?.unmount());

  const own = mount(view({ kind: "own" }));
  await flush();
  type(own.querySelector("textarea") as HTMLTextAreaElement, "Note to self.");
  expect(button("Only comment")?.disabled).toBe(false);
  expect(button("Request changes")?.disabled).toBe(true);
  expect(button("Approve")?.disabled).toBe(true);
  expect(own.textContent).toContain(
    "GitHub does not let you approve or request changes on your own PR.",
  );
  act(() => root?.unmount());

  const moved = mount(view({ kind: "head-moved", analysed: HEAD, live: "f".repeat(40) }));
  await flush();
  expect(moved.textContent).toContain("New commits since the run.");
  expect(button("Approve")?.disabled).toBe(true);
  expect(container).toBeTruthy();
});

it("removes a pending comment", async () => {
  comments = [comment("cmt_1")];
  const container = mount(view({ kind: "can-approve" }));
  await flush();
  act(() =>
    (container.querySelector('[aria-label="Remove the comment on a.ts:3"]') as HTMLElement).click(),
  );
  await flush();
  expect(container.textContent).toContain("No comments yet");
});

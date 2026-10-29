import type { Anchor, ChangeReport, ChatMessage, ChatStreamEvent } from "@strata/core/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Ask } from "./Ask";

const HUNK = "hunk_0123456789abcdef";
const report = {
  change: {
    repo: { kind: "github", owner: "acme", name: "app" },
    hunks: [{ id: HUNK, path: "app/forecast_cache.py", lines: [] }],
  },
  parts: [],
  analysis: { startedAt: "2026-10-29T10:00:00Z" },
} as unknown as ChangeReport;

const anchor: Anchor = {
  source: { kind: "hunk", hunkId: HUNK },
  quote: { exact: "TTL = timedelta(hours=6)", prefix: "", suffix: "" },
};

let saved: ChatMessage[];
let sent: unknown[];
let send: boolean;

const sse = (events: ChatStreamEvent[]) =>
  new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );

beforeEach(() => {
  saved = [];
  sent = [];
  send = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/repos/acme/app/settings") {
        return Response.json({
          repo: "acme/app",
          sendCodeToAnthropic: send,
          claudeAvailable: true,
        });
      }
      if (url === "/api/changes/chg_1/threads" && init?.method === "POST") {
        return Response.json(
          { id: "thr_1", changeId: "chg_1", title: "", createdAt: "" },
          { status: 201 },
        );
      }
      if (url === "/api/changes/chg_1/threads") {
        return Response.json(
          saved.length
            ? [{ id: "thr_1", changeId: "chg_1", title: "Why six hours?", createdAt: "" }]
            : [],
        );
      }
      if (url === "/api/threads/thr_1/messages" && init?.method === "POST") {
        sent.push(JSON.parse(String(init.body)));
        const base = { threadId: "thr_1", analysedAt: "2026-10-29T10:00:00Z", createdAt: "" };
        const answer = `The cache keeps forecasts for six hours [${HUNK}].`;
        saved = [
          { ...base, id: "m1", role: "user", text: "Why six hours?", anchors: [anchor] },
          { ...base, id: "m2", role: "assistant", text: answer, anchors: [] },
        ];
        return sse([
          { type: "status", text: "Claude reads app/forecast_cache.py at the head" },
          { type: "delta", text: "The cache keeps" },
          { type: "delta", text: ` forecasts for six hours [${HUNK}].` },
          { type: "done", message: saved[1] as ChatMessage },
        ]);
      }
      if (url === "/api/threads/thr_1/messages") return Response.json(saved);
      return Response.json({ error: "Not found." }, { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

function render(props: { anchors: Anchor[]; onCite?: (id: string) => void }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const cleared = vi.fn();
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Ask
          changeId="chg_1"
          report={report}
          anchors={props.anchors}
          onRemoveAnchor={() => {}}
          onClearAnchors={cleared}
          onCite={props.onCite ?? (() => {})}
        />
      </QueryClientProvider>,
    ),
  );
  return { container, root, cleared };
}

it("sends a question with its highlight, streams the answer, and links its citations", async () => {
  const cited: string[] = [];
  const { container, root, cleared } = render({
    anchors: [anchor],
    onCite: (id) => cited.push(id),
  });
  await flush();
  expect(container.textContent).toContain("Ask Claude about this Change.");
  expect(container.querySelector('[aria-label="Highlights"]')?.textContent).toBe(
    "app/forecast_cache.py",
  );

  const box = container.querySelector("textarea") as HTMLTextAreaElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(box, "Why six hours?");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await flush();
  await flush();

  expect(sent).toEqual([{ text: "Why six hours?", anchors: [anchor] }]);
  expect(cleared).toHaveBeenCalled();
  const log = container.querySelector(".ask-log") as HTMLElement;
  expect(log.textContent).toContain("Why six hours?");
  expect(log.textContent).toContain("TTL = timedelta(hours=6)");
  expect(log.textContent).toContain("The cache keeps forecasts for six hours");
  const citation = log.querySelector("button.cite") as HTMLButtonElement;
  expect(citation.textContent).toBe("forecast_cache.py");
  act(() => citation.click());
  expect(cited).toEqual([HUNK]);
  expect(container.querySelector('select[aria-label="Thread"]')?.textContent).toContain(
    "Why six hours?",
  );
  act(() => root.unmount());
});

it("points to Settings when the repo does not let Claude read its code", async () => {
  send = false;
  const { container, root } = render({ anchors: [] });
  await flush();
  expect(container.textContent).toContain(
    "Claude cannot read the code in acme/app. To ask Claude, turn on the setting in Settings.",
  );
  expect(container.querySelector('a[href="/settings"]')).not.toBeNull();
  act(() => root.unmount());
});

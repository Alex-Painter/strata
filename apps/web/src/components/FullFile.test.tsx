import type { ChangeReport, DiffLine } from "@strata/core/model";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HunkCard } from "./Diff";
import { FullFileContext, FullFileDialog, type FullFileTarget } from "./FullFile";

const PATH = "app/screens.py";
const lines: DiffLine[] = [
  { kind: "context", content: "b", oldLine: 2, newLine: 2 },
  { kind: "add", content: "X", newLine: 3 },
  { kind: "context", content: "c", oldLine: 3, newLine: 4 },
];
const hunk = {
  id: "hunk_1",
  path: PATH,
  oldStart: 2,
  oldLines: 2,
  newStart: 2,
  newLines: 3,
  section: "",
  lines,
  mechanical: null,
};
const report = {
  change: {
    repo: { kind: "github", owner: "acme", name: "app" },
    revisions: { base: "base1", head: "head1" },
    hunks: [hunk],
  },
  parts: [{ pr: 7, to: "pr7end", from: "pr7start", hunks: [hunk] }],
} as unknown as ChangeReport;

let requested: string[];
let content: string;
beforeEach(() => {
  requested = [];
  content = "a\nb\nX\nc\nd\n";
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      return Response.json({ path: PATH, revision: "x", content });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function show(target: FullFileTarget) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <FullFileDialog changeId="chg_1" report={report} target={target} onClose={() => {}} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return host;
}

it("shows the whole file at the head, the hunk in place and outlined", async () => {
  const host = await show({ path: PATH, focus: "hunk_1" });
  expect(requested).toEqual([`/api/changes/chg_1/file?path=${encodeURIComponent(PATH)}&rev=head1`]);
  const text = [...host.querySelectorAll(".ln")].map((ln) => ln.textContent);
  expect(text).toEqual(["1 a", "2 b", "3+X", "4 c", "5 d"]);
  const focused = host.querySelector('[data-focus="true"]');
  expect(focused?.getAttribute("data-full-hunk")).toBe("hunk_1");
  expect(focused?.querySelector('[data-line="add"]')?.textContent).toContain("X");
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
});

it("reads a PR's own hunk where that PR's diff ends", async () => {
  await show({ path: PATH, pr: 7, focus: "hunk_1" });
  expect(requested[0]).toMatch(/rev=pr7end$/);
});

it("says so when the file does not agree with the diff", async () => {
  content = "a\nb\nY\nc\n";
  const host = await show({ path: PATH, focus: null });
  expect(host.textContent).toContain("does not agree with the diff");
  expect(host.querySelector(".ln")).toBeNull();
});

it("puts the open button on a hunk only where a server can read files", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const opened: FullFileTarget[] = [];
  await act(async () => root.render(<HunkCard hunk={hunk as never} />));
  expect(host.querySelector('[aria-label^="Open all of"]')).toBeNull();
  await act(async () =>
    root.render(
      <FullFileContext.Provider value={(target) => opened.push(target)}>
        <HunkCard hunk={hunk as never} pr={7} />
      </FullFileContext.Provider>,
    ),
  );
  const button = host.querySelector<HTMLButtonElement>('[aria-label^="Open all of"]');
  await act(async () => button?.click());
  expect(opened).toEqual([{ path: PATH, pr: 7, focus: "hunk_1" }]);
});

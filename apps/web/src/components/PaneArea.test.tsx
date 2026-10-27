import {
  buildDiff,
  createClassifier,
  guideGroups,
  REPORT_SCHEMA_VERSION,
  ruleGuide,
  summarizeStack,
} from "@strata/core";
import type { ChangeReport, Hunk, Stack, StackPr, StackSummary } from "@strata/core/model";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PaneArea, type RunView } from "./PaneArea";

const adding = (path: string, ...lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

const whole = buildDiff(
  [
    adding("app/models/account.py", "class Account:", "    forecast: bool"),
    adding("uv.lock", "[[package]]"),
  ].join(""),
  { classifier: createClassifier() },
);
const [model] = whole.hunks as [Hunk, Hunk];
const base = "a".repeat(40);
const head = "b".repeat(40);

const range: ChangeReport = {
  schemaVersion: REPORT_SCHEMA_VERSION,
  change: {
    id: "chg_range",
    title: "main...feature",
    repo: { kind: "github", owner: "acme", name: "app" },
    revisions: { base, head },
    files: whole.files,
    hunks: whole.hunks,
    layers: whole.layers,
    hints: [{ kind: "commit-range", label: "main...feature", base, head }],
  },
  stack: null,
  parts: [],
  sources: [],
  summary: [
    {
      text: "Accounts get a forecast flag.",
      confidence: "medium",
      evidence: [{ anchor: { source: { kind: "hunk", hunkId: model.id } }, label: "account.py:1" }],
    },
  ],
  guide: ruleGuide(guideGroups(whole)),
  layerSummaries: [],
  diagrams: [],
  notes: ["Strata guessed nothing."],
  raw: { diff: "" },
  analysis: { engineVersion: "test", startedAt: "2026-10-02T00:00:00.000Z", durationMs: 1 },
};

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const pr: StackPr = {
  number: 1,
  title: "Add the forecast flag",
  url: "https://github.com/acme/app/pull/1",
  author: "dev",
  state: "open",
  draft: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  baseRef: "main",
  headRef: "b1",
  headOid: head,
  crossRepository: false,
  mergeCommitOid: null,
  baseOid: null,
  baseChanges: [],
  forcePushes: [],
  review: null,
  checks: null,
};

const stack: Stack = {
  id: "stk_1",
  repo: "acme/app",
  trunk: { name: "main", isDefault: true },
  root: 1,
  base,
  nodes: [{ pr, parent: null, children: [], depth: 0, anchor: base }],
  edges: [],
  paths: [[1]],
  selectedPath: [1],
  seed: 1,
  issues: [],
  notes: ["The whole-stack diff covers #1 only."],
};

function mount(
  report: ChangeReport,
  summary: StackSummary | null = null,
  run: RunView | null = null,
) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <PaneArea
        report={report}
        summary={summary}
        scope={null}
        onScope={() => {}}
        run={run}
        pickingPath={null}
        pickError={null}
      />,
    ),
  );
  return container;
}

describe("PaneArea", () => {
  it("shows a range as its whole diff, read like a whole stack's", () => {
    const page = mount(range);
    expect(page.querySelector("h1")?.textContent).toBe("main...feature");
    expect(page.querySelector("header p")?.textContent).toBe(
      "From aaaaaaa, where it branched, to bbbbbbb",
    );
    const [from, to] = [...page.querySelectorAll("header a")].map((a) => a.getAttribute("href"));
    expect(from).toBe(`https://github.com/acme/app/commit/${base}`);
    expect(to).toBe(`https://github.com/acme/app/commit/${head}`);
    expect(page.textContent).toContain("Strata guessed nothing.");
    expect(page.querySelector("#summary-heading")?.parentElement?.textContent).toContain(
      "Written by Claude from the range's diff alone.",
    );
    expect(page.textContent).toContain("Strata's groups of the range");
    expect(page.querySelectorAll("li[data-section]")).toHaveLength(2);
    // The files, and nothing about PRs: no matrix, no stack.
    expect(page.textContent).toContain("app/models/account.py");
    expect(page.textContent).not.toContain("Layers by PR");
    expect(page.textContent).not.toContain("How it arrived");
  });

  it("keeps a run step's names as they are while refreshing", () => {
    const running = (progress: string): RunView => ({
      info: {
        id: "run_1",
        status: "running",
        progress,
        error: null,
        queuedAt: "2026-10-02T00:00:00.000Z",
        startedAt: "2026-10-02T00:00:00.000Z",
        finishedAt: null,
      },
      loading: false,
      onRunAgain: () => {},
      rerunning: false,
    });
    const status = (progress: string) => {
      const page = mount(range, null, running(progress));
      const text = page.querySelector("[role=status]")?.textContent;
      act(() => root?.unmount());
      return text;
    };
    expect(status("Reading PRs from GitHub: 350 so far")).toBe(
      "Refreshing: reading PRs from GitHub: 350 so far…",
    );
    expect(status("Cloning GlyphicAI/app into Strata's cache")).toBe(
      "Refreshing: cloning GlyphicAI/app into Strata's cache…",
    );
  });

  it("shows the stack's notes before the report's", () => {
    const report = { ...range, change: { ...range.change, hints: [] }, stack };
    const page = mount(report, summarizeStack(stack));
    const text = page.textContent ?? "";
    expect(text).toContain("The whole-stack diff covers #1 only.");
    expect(text.indexOf("The whole-stack diff covers #1 only.")).toBeLessThan(
      text.indexOf("Strata guessed nothing."),
    );
  });
});

import {
  buildDiff,
  createClassifier,
  guideGroups,
  REPORT_SCHEMA_VERSION,
  ruleGuide,
} from "@strata/core";
import type { ChangeReport, Hunk } from "@strata/core/model";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PaneArea } from "./PaneArea";

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

function mount(report: ChangeReport) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <PaneArea
        report={report}
        summary={null}
        scope={null}
        onScope={() => {}}
        run={null}
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
});

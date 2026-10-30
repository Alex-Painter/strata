import {
  buildDiff,
  createClassifier,
  guideGroups,
  REPORT_SCHEMA_VERSION,
  ruleGuide,
} from "@strata/core";
import type { ChangeReport, Hunk, PrPart, Stack, StackPr, YourPr } from "@strata/core/model";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Nav } from "./model";
import type { RunView } from "./Overview";
import { Workspace } from "./Workspace";

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
beforeEach(() => localStorage.clear());
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

function Harness({
  report,
  run,
  start = { layer: null, pr: null },
  yours = [],
}: {
  report: ChangeReport;
  run: RunView | null;
  start?: Nav;
  yours?: YourPr[];
}) {
  const [nav, setNav] = useState<Nav>(start);
  return <Workspace report={report} run={run} nav={nav} onNav={setNav} yours={yours} />;
}

function mount(report: ChangeReport, run: RunView | null = null, start?: Nav, yours?: YourPr[]) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <Harness
        report={report}
        run={run}
        {...(start ? { start } : {})}
        {...(yours ? { yours } : {})}
      />,
    ),
  );
  return container;
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    ) ?? document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });

const button = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === name || b.textContent === name,
  ) as HTMLButtonElement;

const panel = (page: HTMLElement) => page.querySelector('section[aria-label="Details"]');

describe("Workspace", () => {
  it("shows a range as its whole diff, read like a whole stack's", () => {
    const page = mount(range);
    expect(page.querySelector("h1")?.textContent).toBe("main...feature");
    expect(page.querySelector(".canvas header p")?.textContent).toBe(
      "From aaaaaaa, where it branched, to bbbbbbb",
    );
    const [from, to] = [...page.querySelectorAll(".canvas header a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(from).toBe(`https://github.com/acme/app/commit/${base}`);
    expect(to).toBe(`https://github.com/acme/app/commit/${head}`);
    expect(panel(page)?.textContent).toContain("Strata guessed nothing.");
    // Each section explains itself in a tip on its heading, not on the page.
    expect(page.querySelector("#summary-heading .info")?.getAttribute("aria-label")).toBe(
      "This summary uses only the range's diff. Each sentence names the hunks that it rests on.",
    );
    expect(page.querySelector("#summary-heading")?.textContent).toBe("Summary");
    expect(page.querySelector("#guide-heading .info")?.getAttribute("aria-label")).toContain(
      "Strata's groups of the range",
    );
    expect(page.querySelectorAll("li[data-section]")).toHaveLength(2);
    // Nothing about PRs: no matrix, no stack, no PR list.
    expect(page.textContent).not.toContain("Layers by PR");
    expect(page.querySelector('header[data-scope="pr"]')).toBeNull();
    expect(page.querySelector('ul[aria-label="Pull requests"]')).toBeNull();
    expect(button(page, "Overview").getAttribute("aria-current")).toBe("true");
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
      const page = mount(range, running(progress));
      const text = page.querySelector(".canvas [role=status]")?.textContent;
      act(() => root?.unmount());
      return text;
    };
    expect(status("Strata reads PRs from GitHub: 350 at this time")).toBe(
      "Strata refreshes the report. Strata reads PRs from GitHub: 350 at this time…",
    );
  });

  it("analyses a Change again from the details", () => {
    let asked = 0;
    const page = mount(range, {
      info: {
        id: "run_1",
        status: "done",
        progress: null,
        error: null,
        queuedAt: "2026-10-02T00:00:00.000Z",
        startedAt: "2026-10-02T00:00:00.000Z",
        finishedAt: "2026-10-02T00:00:00.000Z",
      },
      loading: false,
      onRunAgain: () => {
        asked += 1;
      },
      rerunning: false,
    });
    const details = page.querySelector('[aria-label="Details"]') as HTMLElement;
    act(() => button(details, "Run again").click());
    expect(asked).toBe(1);
  });

  it("marks the PRs you reviewed in the status, and still opens on the whole stack", () => {
    const report = { ...range, change: { ...range.change, hints: [] }, stack };
    const page = mount(report, null, undefined, [
      {
        number: 1,
        reasons: [
          { kind: "review-requested", direct: false, teams: ["acme/backend"] },
          { kind: "reviewed" },
        ],
        active: true,
        seenAt: "2026-10-02T00:00:00Z",
      },
    ]);
    // The PR rows do not say "yours"; the status says what you did.
    expect(page.querySelector("[data-yours]")).toBeNull();
    const details = page.querySelector('[aria-label="Details"]')?.textContent ?? "";
    expect(details).toContain("Reviewed by you");
    expect(details).not.toContain("Needs your review");
    expect(button(page, "Whole stack").getAttribute("aria-current")).toBe("true");
  });

  it("lists the PRs in the status newest first, as the Pull requests tree does", () => {
    const two: Stack = {
      ...stack,
      nodes: [
        { pr, parent: null, children: [2], depth: 0, anchor: base },
        {
          pr: { ...pr, number: 2, title: "Second" },
          parent: 1,
          children: [],
          depth: 1,
          anchor: base,
        },
      ],
      paths: [[1, 2]],
      selectedPath: [1, 2],
    };
    const page = mount({ ...range, change: { ...range.change, hints: [] }, stack: two });
    const rows = [...page.querySelectorAll('[aria-label="Each PR"] li')].map((li) =>
      li.textContent?.slice(0, 2),
    );
    expect(rows).toEqual(["#2", "#1"]);
  });

  it("shows the stack's notes before the report's", () => {
    const report = { ...range, change: { ...range.change, hints: [] }, stack };
    const text = panel(mount(report))?.textContent ?? "";
    expect(text).toContain("The whole-stack diff covers #1 only.");
    expect(text.indexOf("The whole-stack diff covers #1 only.")).toBeLessThan(
      text.indexOf("Strata guessed nothing."),
    );
  });

  it("lists the layers and PRs in the Change pane, and scopes to a PR", () => {
    const report = { ...range, change: { ...range.change, hints: [] }, stack };
    const page = mount(report);
    const nav = page.querySelector('aside[aria-label="Change"]') as HTMLElement;
    expect(
      [...nav.querySelectorAll("[data-layer]")].map((row) => [
        row.getAttribute("data-layer"),
        row.textContent,
      ]),
    ).toEqual([
      ["data-model", "Data model1"],
      ["config", "Config & infra1"],
    ]);
    expect(button(page, "Whole stack").getAttribute("aria-current")).toBe("true");
    const row = button(page, "Show #1 Add the forecast flag");
    expect(row.closest("li")?.getAttribute("data-pr")).toBe("1");
    act(() => row.click());
    expect(page.querySelector('header[data-scope="pr"]')).not.toBeNull();
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(page.querySelector(".vbar")?.textContent).toContain("Only #1");
    press("Escape");
    expect(page.querySelector('header[data-scope="pr"]')).toBeNull();
  });

  it("opens a matrix cell's file in that PR's scope and layer", () => {
    const part: PrPart = {
      pr: 1,
      how: "direct",
      from: base,
      to: head,
      files: whole.files,
      hunks: whole.hunks,
      github: null,
      provenance: null,
      summary: [],
    };
    const report = { ...range, change: { ...range.change, hints: [] }, stack, parts: [part] };
    const page = mount(report);
    press("m");
    act(() =>
      (page.querySelector('button[aria-label^="Data model in #1"]') as HTMLButtonElement).click(),
    );
    act(() =>
      (page.querySelector('section[aria-label="Data model in #1"] a') as HTMLAnchorElement).click(),
    );
    expect(page.querySelector(".vbar h2")?.textContent).toBe("Data model");
    expect(page.querySelector(".vbar")?.textContent).toContain("Only #1");
    expect(panel(page)?.querySelector("h2")?.textContent).toBe("app/models/account.py");
  });

  it("shows a layer's files and hunks, and the details of what J selects", () => {
    const page = mount(range);
    act(() => (page.querySelector('[data-layer="data-model"]') as HTMLButtonElement).click());
    expect(page.querySelector(".vbar h2")?.textContent).toBe("Data model");
    expect(page.querySelector(".canvas [data-file]")?.getAttribute("data-file")).toBe(
      "app/models/account.py",
    );
    expect(page.querySelector(".canvas")?.textContent).toContain("forecast: bool");

    press("j");
    expect(panel(page)?.querySelector("h2")?.textContent).toBe("app/models/account.py");
    press("j");
    expect(panel(page)?.textContent).toContain("@@ -0,0 +1,2");
    expect(page.querySelector(`[data-hunk="${model.id}"]`)?.getAttribute("data-selected")).toBe(
      "true",
    );
    press("Escape");
    expect(panel(page)?.textContent).toContain("Properties");
    expect(page.querySelector('[data-selected="true"]')).toBeNull();

    // ↓ walks the layers in review order; ↑ goes back to the overview.
    press("ArrowDown");
    expect(page.querySelector(".vbar h2")?.textContent).toBe("Config & infra");
    press("ArrowUp");
    press("ArrowUp");
    expect(page.querySelector(".vbar h2")?.textContent).toBe("Overview");
  });

  it("opens a sentence's hunks under it, and its details in the left pane", () => {
    const page = mount(range);
    const chip = page.querySelector("[data-claim] button") as HTMLButtonElement;
    act(() => chip.click());
    const details = panel(page);
    expect(details?.closest('aside[aria-label="Change"]')).not.toBeNull();
    expect(details?.querySelector("h2")?.textContent).toBe("Accounts get a forecast flag.");
    expect(details?.textContent).toContain("From the range's diff · ");
    // The code shows on the canvas, under the sentence, and never in the details.
    expect(details?.querySelector("[data-hunk]")).toBeNull();
    const claim = chip.closest("[data-claim]") as HTMLElement;
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(claim.querySelector(`[data-hunk="${model.id}"]`)?.textContent).toContain(
      "app/models/account.py",
    );
    // Choosing a hunk shows it in its layer.
    act(() => (claim.querySelector(".hsel") as HTMLButtonElement).click());
    expect(page.querySelector(".vbar h2")?.textContent).toBe("Data model");
    expect(
      page.querySelector(`.canvas [data-hunk="${model.id}"]`)?.getAttribute("data-selected"),
    ).toBe("true");
    expect(panel(page)?.textContent).toContain("@@ -0,0 +1,2");
    act(() => button(page, "Show the Change").click());
    expect(panel(page)?.textContent).toContain("Properties");
  });

  it("closes a sentence's hunks with the same button", () => {
    const page = mount(range);
    const chip = page.querySelector("[data-claim] button") as HTMLButtonElement;
    act(() => chip.click());
    act(() => chip.click());
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(page.querySelector(".claim-ev")).toBeNull();
  });

  it("keeps secondary options behind Display, with a chip for each one that's on", () => {
    const page = mount(range);
    press("v");
    const dialog = page.querySelector('[role="dialog"][aria-label="Display"]');
    const seams = [...(dialog?.querySelectorAll('[role="switch"]') ?? [])].find((s) =>
      s.textContent?.startsWith("PR seams"),
    ) as HTMLButtonElement;
    expect(seams.getAttribute("aria-checked")).toBe("false");
    // A range has no PRs, so no matrix.
    expect(
      page.querySelector<HTMLButtonElement>('[aria-label="Display"] [role="switch"]')?.disabled,
    ).toBe(true);
    const chips = () => [...page.querySelectorAll(".vbar .fchip")].map((c) => c.textContent);
    act(() => seams.click());
    expect(chips()).toEqual(["PR seams"]);
    act(() => button(page, "Remove PR seams").click());
    expect(chips()).toEqual([]);
    press("Escape");
    expect(page.querySelector('[aria-label="Display"][role="dialog"]')).toBeNull();
  });

  it("has a shortcuts sheet, a command menu, and no chat on a snapshot", () => {
    const page = mount(range);
    press("?");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Keyboard shortcuts");
    press("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    press("k", { metaKey: true });
    const input = document.querySelector('input[aria-label^="Search"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const options = () =>
      [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options()).toContain("Data model1 file");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "uv.lock");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options()).toEqual(["uv.lockConfig & infra"]);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(page.querySelector(".vbar h2")?.textContent).toBe("Config & infra");
    expect(panel(page)?.querySelector("h2")?.textContent).toBe("uv.lock");

    // The CLI's page has no server, thus no chat panel.
    expect(page.querySelector('aside[aria-label="Ask Claude"]')).toBeNull();
    press("\\");
    expect(page.querySelector('aside[aria-label="Ask Claude"]')).toBeNull();
  });
});

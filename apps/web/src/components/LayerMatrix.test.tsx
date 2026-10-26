import { buildDiff, createClassifier, layerMatrix, prLayerBars } from "@strata/core";
import type { ChangeReport, PrPart } from "@strata/core/model";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { originChips, revisedBy, revisionChips } from "../lib/provenance";
import { Files } from "./Diff";
import { LayerMatrixView } from "./LayerMatrix";
import { StackMap } from "./StackMap";

const adding = (path: string, ...lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

const classifier = createClassifier();

/** #1 adds a model and a service; #2 rewrites a line of the service and bumps a lockfile. */
function report(): Pick<ChangeReport, "change" | "parts"> {
  const model = adding("app/models/user.py", "class User:", "    name: str");
  const service = adding("app/billing.py", "TOTAL = 0", "RATE = 1");
  const lock = adding("uv.lock", "v = 1");
  const whole = buildDiff(
    [model, adding("app/billing.py", "TOTAL = 0", "RATE = 2"), lock].join(""),
    {
      classifier,
    },
  );
  const one = buildDiff(model + service, { classifier });
  const two = buildDiff(
    `diff --git a/app/billing.py b/app/billing.py\n--- a/app/billing.py\n+++ b/app/billing.py\n@@ -1,2 +1,2 @@\n TOTAL = 0\n-RATE = 1\n+RATE = 2\n${lock}`,
    { classifier },
  );
  const id = (hunks: typeof whole.hunks, path: string) =>
    hunks.find((hunk) => hunk.path === path)?.id ?? "";
  const parts: PrPart[] = [
    {
      pr: 1,
      how: "direct",
      from: "a",
      to: "b",
      ...one,
      github: null,
      provenance: {
        inWhole: [
          { hunkId: id(whole.hunks, "app/billing.py"), added: 1, removed: 0 },
          { hunkId: id(whole.hunks, "app/models/user.py"), added: 2, removed: 0 },
        ],
        revisedLater: [{ hunkId: id(one.hunks, "app/billing.py"), by: 2, lines: 1 }],
      },
    },
    {
      pr: 2,
      how: "direct",
      from: "b",
      to: "c",
      ...two,
      github: null,
      provenance: {
        inWhole: [{ hunkId: id(whole.hunks, "app/billing.py"), added: 1, removed: 0 }],
        revisedLater: [],
      },
    },
  ];
  return {
    change: {
      ...whole,
      id: "chg",
      title: "Billing",
      repo: { kind: "github", owner: "acme", name: "app" },
      revisions: null,
      hints: [],
    },
    parts,
  };
}

const titles = new Map([
  [1, "Add billing"],
  [2, "Fix the rate"],
]);

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

describe("LayerMatrixView", () => {
  it("draws a row per layer and a column per PR, then Net", () => {
    const page = mount(
      <LayerMatrixView matrix={layerMatrix(report())} titles={titles} onOpen={() => {}} />,
    );
    const table = page.querySelector('table[aria-labelledby="matrix-heading"]');
    const heads = [...(table?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent);
    expect(heads).toEqual(["Layer", "#1", "#2", "Net"]);
    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) => [
      tr.getAttribute("data-layer"),
      ...[...tr.querySelectorAll("td")].map((td) => td.textContent),
    ]);
    expect(rows).toEqual([
      ["data-model", "2", "", "2"],
      ["logic", "2↻1", "2", "2"],
      ["config", "", "0+1m", "0+1m"],
    ]);
    expect(page.textContent).toContain("↻ marks lines a later PR changed again");
    const logic = page.querySelector('button[aria-label^="Logic in #1"]');
    expect(logic?.getAttribute("aria-label")).toBe(
      "Logic in #1: 2 lines, 1 line changed again later, 1 file",
    );
  });

  it("opens a cell to its files, which open their diff", () => {
    const onOpen = vi.fn();
    const page = mount(
      <LayerMatrixView matrix={layerMatrix(report())} titles={titles} onOpen={onOpen} />,
    );
    const cell = page.querySelector('button[aria-label^="Logic in #2"]') as HTMLButtonElement;
    act(() => cell.click());
    expect(cell.getAttribute("aria-pressed")).toBe("true");
    const region = page.querySelector('section[aria-label="Logic in #2"]');
    expect(region?.textContent).toContain("in #2 Fix the rate");
    expect(region?.textContent).toContain("app/billing.py2 lines · 1 hunk");
    const link = region?.querySelector("a") as HTMLAnchorElement;
    act(() => link.click());
    expect(onOpen).toHaveBeenCalledWith(2, "app/billing.py");
    act(() => cell.click());
    expect(page.querySelector('section[aria-label="Logic in #2"]')).toBeNull();
  });
});

describe("provenance chips", () => {
  it("say which PRs a whole-stack hunk came from", () => {
    const { change, parts } = report();
    const chips = originChips(parts);
    document.body.innerHTML = renderToStaticMarkup(
      <Files files={change.files} hunks={change.hunks} chips={chips} onPr={() => {}} />,
    );
    const billing = [...document.querySelectorAll('[data-file="app/billing.py"] [data-chip]')];
    expect(billing.map((chip) => [chip.textContent, chip.getAttribute("title")])).toEqual([
      ["from #1", "#1 added 1 line of this hunk."],
      ["from #2", "#2 added 1 line of this hunk."],
    ]);
  });

  it("say which later PR revised a PR's hunk", () => {
    const [one] = report().parts as [PrPart];
    document.body.innerHTML = renderToStaticMarkup(
      <Files files={one.files} hunks={one.hunks} chips={revisionChips(one)} onPr={() => {}} />,
    );
    const chip = document.querySelector('[data-file="app/billing.py"] [data-chip="2"]');
    expect(chip?.textContent).toBe("revised in #2");
    expect(chip?.getAttribute("title")).toBe("1 line of this hunk was changed again in #2.");
    expect(revisedBy(one, [1, 2])).toEqual([{ pr: 2, lines: 1 }]);
  });
});

describe("layer bars", () => {
  it("split each PR's lines by layer, with mechanical lines last", () => {
    const bars = prLayerBars(layerMatrix(report()));
    const summary = {
      id: "stk",
      repo: "acme/app",
      trunk: "main",
      base: "a".repeat(40),
      root: 1,
      prs: [1, 2].map((number) => ({
        number,
        title: titles.get(number) ?? "",
        url: `https://github.com/acme/app/pull/${number}`,
        author: "dev",
        state: "open" as const,
        draft: false,
        updatedAt: "2026-10-01T00:00:00Z",
        mergedAt: null,
        baseRef: number === 1 ? "main" : "b1",
        headRef: `b${number}`,
        mergeCommitOid: null,
        parent: number === 1 ? null : 1,
        link: number === 1 ? null : ("intact" as const),
        linkEvidence: [],
        review: null,
        checks: null,
      })),
      paths: [[1, 2]],
      defaultPath: [1, 2],
      issues: [],
      updatedAt: "2026-10-01T00:00:00Z",
    };
    document.body.innerHTML = renderToStaticMarkup(<StackMap stack={summary} bars={bars} />);
    const bar = (pr: number) => document.querySelector(`li[data-pr="${pr}"] [data-bar]`);
    expect(bar(1)?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "4 lines in 2 files",
    );
    expect(
      [...(bar(2)?.querySelectorAll("[data-layer]") ?? [])].map((s) =>
        s.getAttribute("data-layer"),
      ),
    ).toEqual(["logic", "mechanical"]);
    expect(document.querySelector('li[data-pr="1"]')?.getAttribute("style")).toContain(
      "height:64px",
    );
  });
});

import type { ChangeReport, PrVerification, VerificationItem } from "@strata/core/model";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrVerificationView, railMarks, StackVerification } from "./Verification";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

const item = (
  id: string,
  fields: Partial<VerificationItem> & Pick<VerificationItem, "kind" | "title">,
): VerificationItem => ({
  id,
  pr: 2,
  source: "check",
  result: "pass",
  strength: "observed",
  commit: HEAD,
  ...fields,
});

const two: PrVerification = {
  pr: 2,
  head: HEAD,
  bodyAt: null,
  headAt: null,
  items: [
    item("c1", {
      kind: "check",
      title: "Backend CI / Unit tests",
      result: "fail",
      url: "https://ci/1",
    }),
    item("c2", { kind: "check", title: "Lint", result: "pass" }),
    item("c3", { kind: "check", title: "Deploy backend", result: "skipped" }),
    item("t1", {
      kind: "test",
      title: "`uv run pytest` passed.",
      source: "pr-body",
      result: "claimed",
      strength: "claimed",
      commit: null,
    }),
    item("s1", {
      kind: "screenshot",
      title: "Before: the old row.",
      source: "pr-body",
      result: "claimed",
      strength: "attached",
      commit: null,
      pairing: "before",
      media: { type: "image", url: "https://img.test/before.png" },
    }),
    item("r1", {
      kind: "human-review",
      title: "alex approved",
      source: "review",
      by: "alex",
      commit: OLD,
    }),
    item("n1", {
      kind: "not-run",
      title: "The live view on a phone.",
      source: "pr-body",
      result: "not-run",
      strength: "claimed",
      commit: null,
    }),
  ],
  flags: [
    {
      kind: "contradiction",
      pr: 2,
      message: "CI reports failing tests on #2. The PR body says that the tests pass.",
      itemIds: ["c1", "t1"],
    },
  ],
};

const one: PrVerification = {
  pr: 1,
  head: OLD,
  bodyAt: null,
  headAt: null,
  items: [item("c4", { pr: 1, kind: "check", title: "Lint", commit: OLD })],
  flags: [],
};

const report = {
  change: { revisions: { base: "c".repeat(40), head: HEAD } },
  verification: { prs: [one, two], notes: [] },
} as unknown as ChangeReport;

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

describe("PrVerificationView", () => {
  it("shows the flags, the checks, the screenshots and each group", () => {
    const html = renderToStaticMarkup(<PrVerificationView verification={two} />);
    expect(html).toContain("CI reports failing tests on #2. The PR body says that the tests pass.");
    // Checks open by themselves when one fails.
    expect(html).toContain("<details open=");
    expect(html.replace(/<[^>]+>/g, "")).toContain("Checks 1 fail, 1 pass, 1 skipped");
    expect(html).toContain('href="https://ci/1"');
    expect(html).toContain('src="https://img.test/before.png"');
    expect(html).toContain("Before: </span>");
    expect(html).toContain("the old row.");
    expect(html).toContain("<code");
    expect(html).toContain("on old commit bbbbbbb");
    expect(html).toContain("Not verified");
    expect(html).toContain("The live view on a phone.");
  });

  it("offers a link when the image cannot load", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<PrVerificationView verification={two} />));
    const img = host.querySelector("img");
    await act(async () => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(host.textContent).toContain("Strata cannot show this file. Open it on its site.");
    act(() => root.unmount());
  });
});

describe("StackVerification", () => {
  it("leads with the weakest cell and shows a row per PR and the whole stack", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const onScope = vi.fn();
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <StackVerification report={report} titles={new Map([[2, "Second"]])} onScope={onScope} />,
      ),
    );
    expect(host.textContent).toContain("Weakest: CI of #2 fails.");
    const rows = [...host.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-pr"));
    expect(rows).toEqual(["1", "2", "whole"]);
    const cell = host.querySelector('tr[data-pr="2"] [data-status="fail"]');
    expect(cell?.textContent).toBe("1 fails");
    expect(cell?.getAttribute("title")).toContain("Fails: Backend CI / Unit tests");
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "#2");
    act(() => button?.click());
    expect(onScope).toHaveBeenCalledWith(2);
    act(() => root.unmount());
  });

  it("shows nothing for a report from before verification, and its notes when GitHub failed", () => {
    const old = { change: { revisions: null } } as unknown as ChangeReport;
    expect(
      renderToStaticMarkup(
        <StackVerification report={old} titles={new Map()} onScope={() => {}} />,
      ),
    ).toBe("");
    const failed = {
      ...old,
      verification: { prs: [], notes: ["Strata cannot read the verification from GitHub."] },
    } as unknown as ChangeReport;
    expect(
      renderToStaticMarkup(
        <StackVerification report={failed} titles={new Map()} onScope={() => {}} />,
      ),
    ).toContain("Strata cannot read the verification from GitHub.");
  });
});

describe("railMarks", () => {
  it("marks the PRs whose CI fails", () => {
    expect([...railMarks(report)]).toEqual([[2, "CI fails"]]);
    expect([...railMarks(null)]).toEqual([]);
  });
});

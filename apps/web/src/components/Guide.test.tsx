import { assembleGuide, buildDiff, createClassifier, guideGroups, ruleGuide } from "@strata/core";
import type { Claim, Hunk } from "@strata/core/model";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimList } from "./Claims";
import { GuideView } from "./Guide";

const adding = (path: string, ...lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

const whole = buildDiff(
  [
    adding("app/models/account.py", "class Account:", "    forecast: bool"),
    adding("app/services/forecasts.py", "def forecast(account):", "    return []"),
    adding("uv.lock", "[[package]]"),
  ].join(""),
  { classifier: createClassifier() },
);
const hunks = new Map(whole.hunks.map((hunk) => [hunk.id, hunk]));
const [model, service] = whole.hunks as [Hunk, Hunk, Hunk];

const claim = (text: string, ...cited: Array<Hunk | string>): Claim => ({
  text,
  confidence: "medium",
  evidence: cited.map((hunk) => ({
    anchor: { source: { kind: "hunk", hunkId: typeof hunk === "string" ? hunk : hunk.id } },
    label: typeof hunk === "string" ? hunk : `${hunk.path}:${hunk.newStart}`,
  })),
});

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

describe("ClaimList", () => {
  it("names the hunks each sentence rests on, and selects the sentence", () => {
    const onSelect = vi.fn();
    const claims = [claim("Accounts get forecasts.", model, service), claim("A model.", model)];
    const page = mount(
      <ClaimList claims={claims} hunks={hunks} selected={claims[1] ?? null} onSelect={onSelect} />,
    );
    const [first, second] = page.querySelectorAll("[data-claim]");
    const button = first?.querySelector("button") as HTMLButtonElement;
    expect(first?.textContent).toBe("Accounts get forecasts. 2 hunks");
    expect(button.getAttribute("aria-label")).toBe(
      "2 hunks: app/models/account.py:1, app/services/forecasts.py:1",
    );
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(second?.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
    act(() => button.click());
    expect(onSelect).toHaveBeenCalledWith(claims[0]);
  });

  it("shows no sentence whose hunks aren't in the diff", () => {
    const page = mount(
      <ClaimList
        claims={[claim("Rests on nothing here.", "hunk_elsewhere"), claim("Real.", model)]}
        hunks={hunks}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect([...page.querySelectorAll("[data-claim]")].map((li) => li.textContent)).toEqual([
      "Real. 1 hunk",
    ]);
  });
});

describe("GuideView", () => {
  const groups = guideGroups(whole);

  it("lists Claude's sections in order, each opening to its files", () => {
    const onFile = vi.fn();
    const onClaim = vi.fn();
    const guide = assembleGuide(groups, [
      {
        title: "Forecasts",
        groupIds: [groups[1]?.id ?? "", groups[0]?.id ?? ""],
        about: [claim("The service reads the account's flag.", service, model)],
      },
    ]);
    const page = mount(
      <GuideView
        guide={guide}
        files={whole.files}
        hunks={hunks}
        onFile={onFile}
        selected={null}
        onClaim={onClaim}
      />,
    );
    expect(page.textContent).toContain(
      "The order in which Claude tells you to read the whole stack",
    );
    const items = [...page.querySelectorAll("li[data-section]")];
    expect(items.map((li) => li.querySelector("button")?.textContent)).toEqual([
      "1Forecasts2 files · +4 −0",
      "2Config & infra: lockfiles1 file · mechanical",
    ]);
    // The section's sentence is selected like any other.
    const sentence = items[0]?.querySelector("[data-claim] button") as HTMLButtonElement;
    expect(sentence.textContent).toBe("2 hunks");
    act(() => sentence.click());
    expect(onClaim).toHaveBeenCalledWith(guide.sections[0]?.about[0]);

    const toggle = items[0]?.querySelector("button") as HTMLButtonElement;
    act(() => toggle.click());
    const list = page.querySelector('ul[aria-label="Files in Forecasts"]');
    expect([...(list?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "app/services/forecasts.py",
      "app/models/account.py",
    ]);
    const first = list?.querySelector("button") as HTMLButtonElement;
    act(() => first.click());
    expect(onFile).toHaveBeenCalledWith("app/services/forecasts.py");
  });

  it("says when it's Strata's own groups", () => {
    const page = mount(
      <GuideView
        guide={ruleGuide(groups)}
        files={whole.files}
        hunks={hunks}
        onFile={() => {}}
        selected={null}
        onClaim={() => {}}
      />,
    );
    expect(page.textContent).toContain("Strata's groups of the whole stack");
    expect(
      [...page.querySelectorAll("li[data-section] > button")].map((b) => b.textContent),
    ).toEqual([
      "1Data model: app/models/1 file · +2 −0",
      "2Logic: app/services/1 file · +2 −0",
      "3Config & infra: lockfiles1 file · mechanical",
    ]);
  });
});

import { buildDiff, createClassifier, guideGroups, type PrPart } from "@strata/core";
import { describe, expect, it } from "vitest";
import { type AskJson, ClaudeError, type JsonQuestion } from "../llm.js";
import { changeName, writeSummaries } from "./summaries.js";

const adding = (path: string, ...lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

const classifier = createClassifier();
const MODEL = adding("app/models/account.py", "class Account:", "    forecast: bool");
const SERVICE = adding("app/services/forecasts.py", "def forecast(account):", "    return []");
const LOCK = adding("uv.lock", "[[package]]");
const whole = buildDiff(MODEL + SERVICE + LOCK, { classifier });

function part(pr: number, diff: string): Pick<PrPart, "pr" | "how" | "files" | "hunks"> {
  return { pr, how: "direct", ...buildDiff(diff, { classifier }) };
}

/** Answers whole-stack and PR questions with `reply`, and records each one. */
function fakeAsk(reply: (question: JsonQuestion) => unknown) {
  const questions: JsonQuestion[] = [];
  const ask: AskJson = async (question) => {
    questions.push(question);
    return reply(question);
  };
  return { ask, questions };
}

const isWhole = (question: JsonQuestion) => question.prompt.startsWith("Strata's groups");

describe("writeSummaries", () => {
  it("asks about the whole stack from its diff alone, citing hunks and groups by label", async () => {
    const { ask, questions } = fakeAsk(() => ({
      name: "  Give accounts a forecast flag. ",
      summary: [{ text: " Accounts get a forecast flag. ", hunks: ["h1"] }],
      sections: [
        {
          title: "Forecasts",
          groups: ["g2", "g1"],
          about: [{ text: "The service reads the flag.", hunks: ["h2", "h1"] }],
        },
      ],
    }));
    const result = await writeSummaries(whole, [], ask);
    // The name comes from the diff alone, tidied to a title.
    expect(result.name).toBe("Give accounts a forecast flag");

    const [question] = questions;
    expect(question?.prompt).toBe(
      [
        "Strata's groups of the change's files, in its default reading order:",
        "g1 Data model: app/models/\n  app/models/account.py (added, +2 -0, Data model): h1",
        "g2 Logic: app/services/\n  app/services/forecasts.py (added, +2 -0, Logic): h2",
        "g3 Config & infra: lockfiles\n  uv.lock (added, +1 -0, Config & infra, mechanical: Dependency lockfile): h3",
        "The hunks:",
        [
          "h1 app/models/account.py @@ -0,0 +1,2 @@",
          "+class Account:",
          "+    forecast: bool",
          "",
          "h2 app/services/forecasts.py @@ -0,0 +1,2 @@",
          "+def forecast(account):",
          "+    return []",
          "",
          "h3 uv.lock @@ -0,0 +1,1 @@",
          "(not shown: Dependency lockfile)",
        ].join("\n"),
      ].join("\n\n"),
    );
    expect(question?.system).toContain("core of the change first");
    expect(question?.schema).toMatchObject({ required: ["name", "summary", "sections"] });

    const [model, service] = whole.hunks;
    expect(result.summary).toEqual([
      {
        text: "Accounts get a forecast flag.",
        confidence: "medium",
        evidence: [
          {
            anchor: { source: { kind: "hunk", hunkId: model?.id } },
            label: "app/models/account.py:1",
          },
        ],
      },
    ]);
    const groups = guideGroups(whole);
    expect(result.guide.by).toBe("llm");
    expect(result.guide.sections.map((s) => [s.id, s.title, s.paths])).toEqual([
      [groups[1]?.id, "Forecasts", ["app/services/forecasts.py", "app/models/account.py"]],
      [groups[2]?.id, "Config & infra: lockfiles", ["uv.lock"]],
    ]);
    expect(result.guide.sections[0]?.about[0]?.evidence.map((e) => e.anchor.source)).toEqual([
      { kind: "hunk", hunkId: service?.id },
      { kind: "hunk", hunkId: model?.id },
    ]);
    expect(result.notes).toEqual([]);
  });

  it("drops sentences that cite a hunk it wasn't shown, or none", async () => {
    const { ask } = fakeAsk(() => ({
      summary: [
        { text: "Kept.", hunks: ["h1", "h1"] },
        { text: "Cites a hunk that doesn't exist.", hunks: ["h9"] },
        { text: "Cites one real hunk and one made up.", hunks: ["h2", "hunk_abc"] },
        { text: "Cites nothing.", hunks: [] },
        { text: "  ", hunks: ["h1"] },
        { text: "Not a list.", hunks: "h1" },
      ],
      sections: [
        { title: "Unknown group", groups: ["g7"], about: [] },
        {
          title: "Model",
          groups: ["g1", "g9"],
          about: [
            { text: "Real.", hunks: ["h1"] },
            { text: "Made up.", hunks: ["h4"] },
          ],
        },
      ],
    }));
    const result = await writeSummaries(whole, [], ask);
    expect(result.summary.map((claim) => [claim.text, claim.evidence.length])).toEqual([
      ["Kept.", 1],
    ]);
    expect(result.guide.sections.map((s) => [s.title, s.about.map((c) => c.text)])).toEqual([
      ["Model", ["Real."]],
      ["Logic: app/services/", []],
      ["Config & infra: lockfiles", []],
    ]);
  });

  it("keeps six summary sentences and two per section at most", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ text: `S${i}.`, hunks: ["h1"] }));
    const { ask } = fakeAsk(() => ({
      summary: many,
      sections: [{ title: "All", groups: ["g1", "g2", "g3"], about: many }],
    }));
    const result = await writeSummaries(whole, [], ask);
    expect(result.summary).toHaveLength(6);
    expect(result.guide.sections).toHaveLength(1);
    expect(result.guide.sections[0]?.about).toHaveLength(2);
  });

  it("cuts long hunks, and lists hunks past the budget by header only", async () => {
    const big = (n: number) =>
      adding(
        `app/big${n}.py`,
        ...Array.from({ length: 200 }, (_, i) => `x${i} = "${"y".repeat(300)}"`),
      );
    const model = buildDiff(Array.from({ length: 6 }, (_, n) => big(n)).join(""), {
      classifier,
    });
    const { ask, questions } = fakeAsk(() => ({ summary: [], sections: [] }));
    await writeSummaries(model, [], ask);
    const prompt = questions[0]?.prompt ?? "";
    const shown = prompt.split("\n").filter((line) => line.startsWith("+x"));
    expect(shown[0]).toHaveLength(201);
    expect(prompt).toContain("(50 more lines not shown)");
    // Each hunk shows 150 lines of 201 characters, about 30,000, so three fit in the budget.
    expect(shown).toHaveLength(3 * 150);
    for (const n of [4, 5, 6]) {
      expect(prompt).toContain(
        `h${n} app/big${n - 1}.py @@ -0,0 +1,200 @@\n(not shown: the change is too big to show every hunk)`,
      );
    }
  });

  it("summarises each PR from its own diff, citing its own hunks", async () => {
    const one = part(1, MODEL + LOCK);
    const two = part(2, SERVICE);
    const unknown = { pr: 3, how: "unknown" as const, files: [], hunks: [] };
    const { ask, questions } = fakeAsk((question) =>
      isWhole(question)
        ? { summary: [], sections: [] }
        : { summary: [{ text: "Does a thing.", hunks: ["h1"] }] },
    );
    const result = await writeSummaries(whole, [one, two, unknown], ask);

    const asked = questions.filter((question) => !isWhole(question));
    expect(asked).toHaveLength(2);
    expect(asked[0]?.prompt).toBe(
      [
        "The files:",
        "  app/models/account.py (added, +2 -0, Data model): h1\n" +
          "  uv.lock (added, +1 -0, Config & infra, mechanical: Dependency lockfile): h2",
        "The hunks:",
        "h1 app/models/account.py @@ -0,0 +1,2 @@\n+class Account:\n+    forecast: bool\n\n" +
          "h2 uv.lock @@ -0,0 +1,1 @@\n(not shown: Dependency lockfile)",
      ].join("\n\n"),
    );
    expect(asked[0]?.system).toContain("one pull request's own diff");
    expect(result.parts.get(2)).toEqual([
      {
        text: "Does a thing.",
        confidence: "medium",
        evidence: [
          {
            anchor: { source: { kind: "pr-hunk", pr: 2, hunkId: two.hunks[0]?.id } },
            label: "app/services/forecasts.py:1",
          },
        ],
      },
    ]);
    expect(result.parts.has(3)).toBe(false);
  });

  it("keeps Strata's groups and says why when Claude can't answer", async () => {
    const { ask } = fakeAsk((question) => {
      if (isWhole(question)) throw new ClaudeError("Claude declined to answer.");
      if (question.prompt.includes("app/services")) throw new ClaudeError("Overloaded");
      return { summary: [{ text: "Adds the model.", hunks: ["h1"] }] };
    });
    const result = await writeSummaries(
      whole,
      [part(1, MODEL), part(2, SERVICE), part(3, SERVICE + LOCK)],
      ask,
    );
    expect(result.summary).toEqual([]);
    expect(result.guide.by).toBe("rule");
    expect(result.guide.sections.map((section) => section.title)).toEqual([
      "Data model: app/models/",
      "Logic: app/services/",
      "Config & infra: lockfiles",
    ]);
    expect(result.parts.get(1)?.map((claim) => claim.text)).toEqual(["Adds the model."]);
    expect(result.notes).toEqual([
      "Strata cannot ask Claude for the summary. Thus the Guide shows Strata's own groups. Cause: Claude declined to answer.",
    ]);
    // How many PRs failed depends on the split, so it's kept apart from the whole-stack notes.
    expect(result.partNotes).toEqual([
      "Strata cannot ask Claude to summarise 2 PRs. Cause: Overloaded",
    ]);
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    const { ask } = fakeAsk(() => {
      controller.abort();
      throw new Error("aborted");
    });
    await expect(writeSummaries(whole, [], ask, controller.signal)).rejects.toThrow();
  });

  it("doesn't ask about a stack with no whole-stack diff", async () => {
    const { ask, questions } = fakeAsk(() => ({ summary: [] }));
    const result = await writeSummaries(null, [], ask);
    expect(questions).toEqual([]);
    expect(result).toEqual({
      name: null,
      summary: [],
      guide: { by: "rule", sections: [] },
      parts: new Map(),
      notes: [],
      partNotes: [],
    });
  });
});

describe("changeName", () => {
  it("keeps a name to one short line, and has none for nothing", () => {
    expect(changeName("Cache\n forecasts  per account.")).toBe("Cache forecasts per account");
    expect(changeName("x".repeat(100))).toBe(`${"x".repeat(79)}…`);
    expect(changeName("  ")).toBeNull();
    expect(changeName(undefined)).toBeNull();
  });
});

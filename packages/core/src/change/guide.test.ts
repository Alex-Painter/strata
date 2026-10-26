import { describe, expect, it } from "vitest";
import { createClassifier } from "../layers/classify.js";
import type { Claim } from "../model/report.js";
import { buildDiff } from "./build.js";
import { assembleGuide, guideGroups, ruleGuide } from "./guide.js";

const adding = (path: string, ...lines: string[]) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

const DIFFS = [
  adding("docs/forecasts.md", "# Forecasts"),
  adding("app/services/forecasts.py", "def forecast(): ..."),
  adding("uv.lock", "v = 1"),
  adding("app/models/account.py", "class Account: ..."),
  adding("app/services/billing.py", "def bill(): ..."),
  adding("gen/api_pb2.py", "# generated"),
  adding("app/jobs/warm.py", "def warm(): ..."),
  adding("pyproject.toml", "[project]"),
  "diff --git a/app/old.py b/app/new_name.py\nsimilarity index 100%\nrename from app/old.py\nrename to app/new_name.py\n",
];

const classifier = createClassifier({ gitattributes: "gen/** linguist-generated\n" });
const model = (diffs = DIFFS) => buildDiff(diffs.join(""), { classifier });

describe("the Guide's groups", () => {
  it("go by layer, then mechanical kind, then directory", () => {
    const groups = guideGroups(model());
    expect(groups.map((group) => [group.title, group.paths])).toEqual([
      ["Data model: app/models/", ["app/models/account.py"]],
      ["Logic: app/jobs/", ["app/jobs/warm.py"]],
      ["Logic: app/services/", ["app/services/billing.py", "app/services/forecasts.py"]],
      ["Logic: renames", ["app/new_name.py"]],
      ["Logic: generated files", ["gen/api_pb2.py"]],
      ["Config & infra: top level", ["pyproject.toml"]],
      ["Config & infra: lockfiles", ["uv.lock"]],
      ["Docs: docs/", ["docs/forecasts.md"]],
    ]);
  });

  it("hold every file and hunk once, in file order", () => {
    const whole = model();
    const groups = guideGroups(whole);
    expect(groups.flatMap((group) => group.paths).sort()).toEqual(
      whole.files.map((file) => file.path),
    );
    expect(groups.flatMap((group) => group.hunkIds).sort()).toEqual(
      whole.hunks.map((hunk) => hunk.id).sort(),
    );
    const services = groups.find((group) => group.title === "Logic: app/services/");
    expect(services?.hunkIds).toEqual(
      whole.hunks.filter((hunk) => hunk.path.startsWith("app/services/")).map((hunk) => hunk.id),
    );
  });

  it("have ids from what they hold, not from the order of the diff", () => {
    const ids = guideGroups(model()).map((group) => group.id);
    expect(guideGroups(model([...DIFFS].reverse())).map((group) => group.id)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("become the Guide as they are when Claude isn't asked", () => {
    const groups = guideGroups(model());
    const guide = ruleGuide(groups);
    expect(guide.by).toBe("rule");
    expect(guide.sections.map((section) => [section.id, section.title, section.about])).toEqual(
      groups.map((group) => [group.id, group.title, []]),
    );
  });
});

describe("assembleGuide", () => {
  const groups = guideGroups(model());
  const id = (title: string) => groups.find((group) => group.title === title)?.id ?? "";
  const claim = (text: string, hunkId?: string): Claim => ({
    text,
    confidence: "medium",
    evidence: hunkId ? [{ anchor: { source: { kind: "hunk", hunkId } }, label: text }] : [],
  });

  it("merges, orders and labels groups the way the plan says", () => {
    const services = groups.find((group) => group.title === "Logic: app/services/");
    const guide = assembleGuide(groups, [
      {
        title: "Forecasts",
        groupIds: [id("Logic: app/services/"), id("Data model: app/models/")],
        about: [claim("Adds forecasts.", services?.hunkIds[0]), claim("Has no evidence.")],
      },
      { title: " Docs ", groupIds: [id("Docs: docs/")], about: [] },
    ]);
    expect(guide.by).toBe("llm");
    const [first, second, ...rest] = guide.sections;
    expect(first).toMatchObject({
      id: id("Logic: app/services/"),
      title: "Forecasts",
      paths: ["app/services/billing.py", "app/services/forecasts.py", "app/models/account.py"],
    });
    expect(first?.about.map((c) => c.text)).toEqual(["Adds forecasts."]);
    expect(second).toMatchObject({ title: "Docs", paths: ["docs/forecasts.md"] });
    // Groups the plan left out keep their own sections, in Strata's order.
    expect(rest.map((section) => section.title)).toEqual([
      "Logic: app/jobs/",
      "Logic: renames",
      "Logic: generated files",
      "Config & infra: top level",
      "Config & infra: lockfiles",
    ]);
  });

  it("ignores unknown groups, keeps a group where it was first named, and drops empty sections", () => {
    const docs = id("Docs: docs/");
    const guide = assembleGuide(groups, [
      { title: "Docs first", groupIds: [docs, docs, "guide_unknown"], about: [] },
      { title: "Docs again", groupIds: [docs], about: [] },
      { title: "Nothing real", groupIds: ["guide_unknown"], about: [] },
      { title: "", groupIds: [id("Logic: app/jobs/"), id("Logic: renames")], about: [] },
    ]);
    expect(guide.sections.map((section) => section.title).slice(0, 2)).toEqual([
      "Docs first",
      "Logic: app/jobs/, Logic: renames",
    ]);
    expect(guide.sections.filter((section) => section.paths.includes("docs/forecasts.md"))).toEqual(
      [expect.objectContaining({ title: "Docs first", paths: ["docs/forecasts.md"] })],
    );
    const hunks = guide.sections.flatMap((section) => section.hunkIds);
    expect(hunks.sort()).toEqual(groups.flatMap((group) => group.hunkIds).sort());
  });

  it("is Strata's own Guide when the plan places nothing", () => {
    expect(assembleGuide(groups, [])).toEqual(ruleGuide(groups));
    expect(assembleGuide(groups, [{ title: "x", groupIds: ["guide_nope"], about: [] }])).toEqual(
      ruleGuide(groups),
    );
  });
});

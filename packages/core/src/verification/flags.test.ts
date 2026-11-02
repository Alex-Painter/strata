import { describe, expect, it } from "vitest";
import type { FileChange } from "../model/change.js";
import type { ChangeReport } from "../model/report.js";
import type { PrVerification, VerificationItem } from "../model/verification.js";
import { verifyMatrix } from "../stack/verify.js";
import { verificationFlags } from "./flags.js";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

let n = 0;
const item = (
  fields: Partial<VerificationItem> & Pick<VerificationItem, "kind">,
): VerificationItem => ({
  id: `ver_${n++}`,
  pr: 1,
  source: "check",
  title: fields.kind,
  result: "pass",
  strength: "observed",
  commit: HEAD,
  ...fields,
});
const claim = (fields: Partial<VerificationItem> & Pick<VerificationItem, "kind">) =>
  item({ source: "pr-body", strength: "claimed", result: "claimed", commit: null, ...fields });

const base = (items: VerificationItem[], times: Partial<PrVerification> = {}) => ({
  pr: 1,
  head: HEAD,
  bodyAt: "2026-10-30T10:00:00Z",
  headAt: "2026-10-30T09:00:00Z",
  items,
  ...times,
});

const uiFile = {
  path: "frontend/Card.tsx",
  layer: { layer: "ui" },
  mechanical: null,
} as unknown as FileChange;

const kinds = (items: VerificationItem[], files: FileChange[] | null = null, times = {}) =>
  verificationFlags(base(items, times), files).map((flag) => flag.kind);

describe("verificationFlags", () => {
  it("flags CI test failures against a body that says the tests pass", () => {
    const flags = verificationFlags(
      base([
        item({ kind: "check", title: "Backend CI / Unit tests", result: "fail" }),
        claim({ kind: "test", title: "Backend unit suite passed locally." }),
      ]),
      null,
    );
    expect(flags[0]).toMatchObject({
      kind: "contradiction",
      message: "CI reports failing tests on #1. The PR body says that the tests pass.",
    });
    expect(flags[0]?.itemIds).toHaveLength(2);
    // A failing lint check is not a test failure.
    expect(
      kinds([
        item({ kind: "check", title: "Lint backend", result: "fail" }),
        claim({ kind: "test", title: "pytest passed" }),
      ]),
    ).not.toContain("contradiction");
  });

  it("names the gaps the author gave, and UI changes with no picture", () => {
    const flags = verificationFlags(
      base([
        item({ kind: "check" }),
        claim({ kind: "not-run", title: "The live view on a phone." }),
        claim({ kind: "not-run", title: "Twilio quick replies." }),
      ]),
      [uiFile],
    );
    expect(flags.map((flag) => flag.message)).toEqual([
      "The author of #1 did not verify 2 things.",
      "#1 changes 1 UI file. It has no screenshot, recording or walk.",
    ]);
    expect(
      kinds(
        [item({ kind: "check" }), claim({ kind: "screenshot", strength: "attached" })],
        [uiFile],
      ),
    ).toEqual([]);
  });

  it("flags a head with no checks, and proof that is only words", () => {
    expect(kinds([claim({ kind: "test", title: "pytest passed" })])).toEqual([
      "no-checks",
      "claimed-only",
    ]);
    expect(kinds([item({ kind: "check", result: "skipped" })])).toEqual(["no-checks"]);
  });

  it("flags an approval on an older commit and a body older than the head", () => {
    const flags = verificationFlags(
      base(
        [
          item({ kind: "check" }),
          item({ kind: "human-review", source: "review", by: "alex", commit: OLD }),
          claim({ kind: "note", title: "Checked by hand." }),
        ],
        { headAt: "2026-10-31T00:00:00Z" },
      ),
      null,
    );
    expect(flags.map((flag) => flag.message)).toEqual([
      "alex approved #1 at bbbbbbb. The head is now aaaaaaa.",
      "The head commit of #1 is newer than the last edit of its PR body. The body can describe older code.",
    ]);
  });
});

describe("verifyMatrix", () => {
  const pr = (number: number, items: VerificationItem[], head = HEAD): PrVerification => ({
    pr: number,
    head,
    bodyAt: null,
    headAt: null,
    items: items.map((i) => ({ ...i, pr: number })),
    flags: [],
  });
  const report = (prs: PrVerification[], issues: unknown[] = []) =>
    ({
      change: { revisions: { base: "c".repeat(40), head: "d".repeat(40) } },
      stack: { issues },
      verification: { prs, notes: [] },
    }) as unknown as ChangeReport;

  it("sums each PR's proof by column and leads with the weakest cell", () => {
    const matrix = verifyMatrix(
      report([
        pr(
          1,
          [
            item({ kind: "check", title: "Unit tests" }),
            item({ kind: "check", title: "Lint" }),
            item({ kind: "check", title: "Deploy", result: "skipped" }),
            claim({
              kind: "screenshot",
              strength: "attached",
              media: { type: "image", url: "https://x/a" },
            }),
            item({ kind: "human-review", source: "review", commit: OLD }),
          ],
          OLD,
        ),
        pr(2, [
          item({ kind: "check", title: "Unit tests", result: "fail" }),
          claim({ kind: "test", title: "pytest passed" }),
          item({ kind: "bot-review", source: "review" }),
        ]),
      ]),
    );
    const cells = (row: number) =>
      matrix?.rows[row]?.cells.map((cell) => [cell.column, cell.status, cell.label]);
    expect(cells(0)).toEqual([
      ["ci", "stale", "Old commit"],
      ["tests", "none", ""],
      ["ui", "pass", "1 screenshot"],
      ["preview", "none", ""],
      ["bot", "none", ""],
      ["human", "pass", "Approved"],
    ]);
    expect(cells(1)).toEqual([
      ["ci", "fail", "1 fails"],
      ["tests", "claimed", "1 claim"],
      ["ui", "none", ""],
      ["preview", "none", ""],
      ["bot", "pass", "Passes"],
      ["human", "none", ""],
    ]);
    expect(matrix?.weakest).toEqual({ pr: 2, column: "ci", status: "fail" });
  });

  it("builds the whole-stack row from the top PR's head commit only", () => {
    const matrix = verifyMatrix(
      report([
        pr(1, [item({ kind: "check", commit: OLD, result: "fail" })], OLD),
        pr(2, [
          item({ kind: "check" }),
          claim({ kind: "test", title: "pytest passed" }),
          item({ kind: "human-review", source: "review" }),
        ]),
      ]),
    );
    const whole = matrix?.rows.find((row) => row.pr === null);
    expect(whole?.cells.map((cell) => [cell.column, cell.status])).toEqual([
      ["ci", "pass"],
      ["tests", "none"],
      ["ui", "none"],
      ["preview", "none"],
      ["bot", "none"],
      ["human", "none"],
    ]);
  });

  it("splits the same head two ways and gives the same whole-stack row", () => {
    const top = [
      item({ kind: "check", title: "CI" }),
      item({ kind: "bot-review", source: "review" }),
    ];
    const one = verifyMatrix(report([pr(7, top)]));
    const two = verifyMatrix(
      report([pr(5, [item({ kind: "check", commit: OLD })], OLD), pr(6, top)]),
    );
    const whole = (m: typeof one) =>
      m?.rows
        .find((row) => row.pr === null)
        ?.cells.map((cell) => [cell.column, cell.status, cell.label]);
    expect(whole(two)).toEqual(whole(one));
  });

  it("marks the whole-stack row old when a PR below needs a restack", () => {
    const prs = [pr(1, [item({ kind: "check" })]), pr(2, [item({ kind: "check" })])];
    const matrix = verifyMatrix(report(prs, [{ kind: "needs-restack", prs: [2] }]));
    expect(matrix?.rows.at(-1)?.cells[0]).toMatchObject({
      status: "stale",
      label: "Needs a restack",
    });
  });

  it("is null without verification", () => {
    expect(verifyMatrix({ change: { revisions: null } } as unknown as ChangeReport)).toBeNull();
  });
});

import { buildDiff } from "@strata/core";
import { describe, expect, it } from "vitest";
import type { JsonQuestion } from "../llm.js";
import { type WhyInput, whyClaims, whyPieces, writeWhy } from "./why.js";

const DIFF = `diff --git a/app/cache.ts b/app/cache.ts
--- a/app/cache.ts
+++ b/app/cache.ts
@@ -1,1 +1,3 @@
 export const a = 1;
+// Big accounts time out without a cache, so keep forecasts for six hours.
+export const TTL = 6 * 3600;
`;

const OID = "a".repeat(40);

function input(fields: Partial<WhyInput> = {}): WhyInput {
  return {
    repo: "acme/app",
    prs: [
      {
        number: 9,
        title: "Cache forecasts per account",
        url: "https://github.com/acme/app/pull/9",
        body: "Big accounts see time-outs on the forecast page.",
        issues: [
          { number: 4, title: "Forecast page times out", body: "It takes 40 s.", url: "u4" },
        ],
      },
    ],
    commits: [
      { oid: OID, message: "Warm the cache every night\n\nSo the first visit of the day is fast." },
      { oid: "b".repeat(40), message: "wip" },
    ],
    whole: buildDiff(DIFF),
    ...fields,
  };
}

describe("whyPieces", () => {
  it("labels descriptions, issues, commits and the comments the diff adds", () => {
    expect(whyPieces(input()).map((piece) => [piece.label, piece.name])).toEqual([
      ["d1", "#9 description"],
      ["i1", "#4 issue"],
      ["c1", `commit ${OID.slice(0, 7)}`],
      ["h1", "app/cache.ts:1"],
    ]);
  });
});

describe("writeWhy", () => {
  it("asks once, with no commit ids, and keeps the sentences whose quotes are real", async () => {
    const asked: JsonQuestion[] = [];
    const result = await writeWhy(input(), async (question) => {
      asked.push(question);
      return {
        why: [
          {
            text: "Big accounts see time-outs on the forecast page.",
            sources: [
              { label: "d1", quote: "Big accounts see  time-outs" },
              { label: "h1", quote: "" },
            ],
          },
          {
            text: "The first visit is fast.",
            sources: [{ label: "c1", quote: "first visit of the day" }],
          },
          { text: "Made up.", sources: [{ label: "i1", quote: "It takes 4 minutes" }] },
          { text: "Only code.", sources: [{ label: "h1", quote: "" }] },
          { text: "No sources.", sources: [] },
        ],
      };
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.task).toBe("change-why");
    expect(asked[0]?.prompt).not.toContain(OID);
    expect(asked[0]?.prompt).not.toContain("wip");
    expect(asked[0]?.system).toContain("ASD-STE100");
    expect(result.why.map((claim) => claim.text)).toEqual([
      "Big accounts see time-outs on the forecast page.",
      "The first visit is fast.",
    ]);
    expect(result.why[0]?.evidence.map((item) => item.label)).toEqual([
      "#9 description",
      "app/cache.ts:1",
    ]);
    // Only the cited texts are kept, as sources the evidence points at.
    expect(result.sources.map((source) => [source.kind, source.title, source.url])).toEqual([
      ["pr-description", "#9 Cache forecasts per account", "https://github.com/acme/app/pull/9"],
      ["commit", `Commit ${OID.slice(0, 7)}`, `https://github.com/acme/app/commit/${OID}`],
    ]);
  });

  it("does not ask when only PR titles and code comments are there", async () => {
    let asked = 0;
    const ask = async () => {
      asked += 1;
      return { why: [] };
    };
    const bare = input({
      prs: [
        { number: 9, title: "Cache forecasts", url: "u", body: "<!-- template -->", issues: [] },
      ],
      commits: [{ oid: OID, message: "wip" }],
    });
    expect(await writeWhy(bare, ask)).toEqual({ why: [], sources: [], notes: [] });
    expect(asked).toBe(0);
  });

  it("gives a note, not an error, when Claude fails", async () => {
    const result = await writeWhy(input(), async () => {
      throw new Error("Claude did not answer.");
    });
    expect(result.why).toEqual([]);
    expect(result.notes).toEqual([
      "Strata cannot ask Claude why the Change exists. Cause: Claude did not answer.",
    ]);
  });
});

describe("whyClaims", () => {
  it("drops a sentence that cites a label Strata did not give", () => {
    const pieces = whyPieces(input());
    const result = whyClaims(
      [
        {
          text: "Real and fake.",
          sources: [
            { label: "d1", quote: "time-outs" },
            { label: "d7", quote: "x" },
          ],
        },
      ],
      pieces,
    );
    expect(result.why).toEqual([]);
  });
});

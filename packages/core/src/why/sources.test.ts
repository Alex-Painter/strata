import { describe, expect, it } from "vitest";
import { buildDiff } from "../change/build.js";
import {
  cleanCommitMessage,
  cleanDescription,
  codeReasons,
  plainDescription,
  quoteIn,
} from "./sources.js";

describe("cleanDescription", () => {
  it("keeps the author's words and drops templates, proof, pictures and footers", () => {
    const body = [
      "<!-- Describe your change -->",
      "## Why",
      "",
      "Sales leads lose deals when they cannot see the trend of each call group.",
      "![chart](https://example.com/a.png)",
      "",
      "## Checklist",
      "- [x] I added tests",
      "",
      "## Verification",
      "- `pytest` passed",
      "",
      "## Notes",
      "",
      "## What",
      "Adds series to calculation groups.",
      "_Requested by **Alex** · [project thread](https://claude.ai/x)_",
      "",
      "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
      "Anything after the footer.",
    ].join("\r\n");
    expect(cleanDescription(body)).toBe(
      [
        "## Why",
        "Sales leads lose deals when they cannot see the trend of each call group.",
        "",
        "## What",
        "Adds series to calculation groups.",
      ].join("\n"),
    );
  });

  it("gives an empty string for no body, or a body that is all template", () => {
    expect(cleanDescription(null)).toBe("");
    expect(cleanDescription("## Summary\n\n<!-- fill in -->\n\n## Testing\n- ran it\n")).toBe("");
  });

  it("drops a proof section's subsections too", () => {
    expect(
      cleanDescription("## Test plan\n### Unit\n- vitest\n## Context\nThe page was slow."),
    ).toBe("## Context\nThe page was slow.");
  });
});

describe("cleanCommitMessage", () => {
  it("drops trailers, and keeps the subject and body", () => {
    expect(
      cleanCommitMessage(
        "Cache forecasts per account\n\nThe page timed out for big accounts.\n\nCo-Authored-By: A <a@b>\nClaude-Session: https://claude.ai/code/session_1",
      ),
    ).toBe("Cache forecasts per account\n\nThe page timed out for big accounts.");
  });

  it("drops merges, fixups, WIP and messages too short to say anything", () => {
    for (const message of [
      "Merge branch 'main' into b2",
      "fixup! Cache forecasts",
      "wip",
      "fix lint",
      "Address review comments",
      "tweaks",
    ]) {
      expect(cleanCommitMessage(message), message).toBeNull();
    }
    expect(cleanCommitMessage("Fix the time zone of the nightly job")).toBe(
      "Fix the time zone of the nightly job",
    );
  });
});

const DIFF = `diff --git a/app/cache.ts b/app/cache.ts
--- a/app/cache.ts
+++ b/app/cache.ts
@@ -1,1 +1,6 @@
 export const a = 1;
+// Big accounts time out without a cache, so keep forecasts for six hours.
+// eslint-disable-next-line no-console
+// TODO
+export const TTL = 6 * 3600;
+const x = "// not a comment";
diff --git a/tests/cache.test.ts b/tests/cache.test.ts
--- a/tests/cache.test.ts
+++ b/tests/cache.test.ts
@@ -1,1 +1,3 @@
 import { it } from "vitest";
+it("keeps a forecast for six hours", () => {});
+def test_warm_cache_runs_nightly(): pass
`;

describe("codeReasons", () => {
  it("takes added comments with words in them, and test names", () => {
    const reasons = codeReasons(buildDiff(DIFF).hunks);
    expect(reasons.map((reason) => [reason.hunk.path, reason.lines])).toEqual([
      [
        "app/cache.ts",
        ["// Big accounts time out without a cache, so keep forecasts for six hours."],
      ],
      [
        "tests/cache.test.ts",
        [
          'it("keeps a forecast for six hours", () => {});',
          "def test_warm_cache_runs_nightly(): pass",
        ],
      ],
    ]);
  });
});

describe("quoteIn", () => {
  it("ignores case and runs of whitespace, but not missing words", () => {
    expect(quoteIn("sales leads   LOSE deals", "Sales leads\nlose deals when")).toBe(true);
    expect(quoteIn("leads win deals", "Sales leads lose deals")).toBe(false);
    expect(quoteIn("  ", "anything")).toBe(false);
  });
});

describe("plainDescription", () => {
  it("keeps the author's whole text, proof sections too, without tool lines", () => {
    const body =
      "Why: runs were slow.\r\n\r\n<!-- fill this in -->\n\n\n\n## Testing\n- [x] Ran it\n\nCo-Authored-By: A <a@b>\n🤖 Generated with Tool\nfooter text";
    expect(plainDescription(body)).toBe("Why: runs were slow.\n\n## Testing\n- [x] Ran it");
    expect(plainDescription(null)).toBe("");
  });
});

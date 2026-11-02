import { describe, expect, it } from "vitest";
import { parsePrBody } from "./body.js";

const pick = (items: ReturnType<typeof parsePrBody>) =>
  items.map(({ kind, title, result, strength, media, pairing, section }) => ({
    kind,
    title,
    result,
    strength,
    ...(media ? { media: media.url } : {}),
    ...(pairing ? { pairing } : {}),
    section,
  }));

// The shape of the PR template in GlyphicAI/maverick-backend, with tool footers.
const TEMPLATE = `<!-- CURSOR_AGENT_PR_BODY_BEGIN -->
## TLDR

<!-- HUMAN-WRITTEN ONLY. Agents: leave this heading. -->

- Custom insights can only be managed in the app's settings.

## Reason for PR

Second of three stacked PRs. Run \`uv run pytest\` is mentioned here but is not proof.

## Verification

Locally on this branch:

- \`uv run pytest maverick/tests/unit/mcp_server\` passed, including the tool contract.
- All \`maverick/tests/integration/test_mcp_*.py\` against a real Mongo container passed.
- Checked the settings page by hand.

Not run: an error path from a TypeScript MCP SDK client.

### Automated tests

- \`test_create_stores_a_call_insight\` catches: a create that stores the wrong fields.
- \`test_caller_without_permission_is_refused\` catches: a member creating an insight.
  - Also covers listing.

### Manual testing

1. Connect an MCP client to a local server.
2. Call \`create_custom_insight\`. Check the user notice.

## Release and rollback

**Release:** No feature flag.
<!-- CURSOR_AGENT_PR_BODY_END -->

<div><a href="https://cursor.com/agents/x"><picture><source srcset="https://cursor.com/assets/images/open-in-web-dark.png"><img alt="Open in Web" src="https://cursor.com/assets/images/open-in-web-dark.png"></picture></a></div>
<!-- codesmith:footer -->
- \`pytest\` in a footer is not proof.
`;

describe("parsePrBody", () => {
  it("reads test claims, notes, gaps and manual steps from the Verification section", () => {
    expect(pick(parsePrBody(9592, TEMPLATE))).toEqual([
      {
        kind: "test",
        title:
          "`uv run pytest maverick/tests/unit/mcp_server` passed, including the tool contract.",
        result: "claimed",
        strength: "claimed",
        section: "Verification",
      },
      {
        kind: "test",
        title:
          "All `maverick/tests/integration/test_mcp_*.py` against a real Mongo container passed.",
        result: "claimed",
        strength: "claimed",
        section: "Verification",
      },
      {
        kind: "note",
        title: "Checked the settings page by hand.",
        result: "claimed",
        strength: "claimed",
        section: "Verification",
      },
      {
        kind: "not-run",
        title: "An error path from a TypeScript MCP SDK client.",
        result: "not-run",
        strength: "claimed",
        section: "Verification",
      },
      {
        kind: "test",
        title:
          "`test_create_stores_a_call_insight` catches: a create that stores the wrong fields.",
        result: "claimed",
        strength: "claimed",
        section: "Automated tests",
      },
      {
        kind: "test",
        title: "`test_caller_without_permission_is_refused` catches: a member creating an insight.",
        result: "claimed",
        strength: "claimed",
        section: "Automated tests",
      },
      {
        kind: "note",
        title: "Manual test: 2 steps",
        result: "claimed",
        strength: "claimed",
        section: "Manual testing",
      },
    ]);
  });

  it("keeps nested bullets and steps as detail", () => {
    const items = parsePrBody(9592, TEMPLATE);
    expect(items.find((item) => item.title.startsWith("`test_caller"))?.detail).toContain(
      "Also covers listing.",
    );
    expect(items.find((item) => item.title === "Manual test: 2 steps")?.detail).toBe(
      "1. Connect an MCP client to a local server.\n2. Call `create_custom_insight`. Check the user notice.",
    );
  });

  it("takes screenshots with their captions and marks before and after", () => {
    const body = `## Screenshots

Before: the completed forecast row still offered Make it automatic.

![Completed forecast row with Make it automatic and Undo](https://cursor.com/artifacts/c/art-1)

After: the same row only has Undo.

![](https://cursor.com/artifacts/c/art-2)

<img width="600" alt="Settings page" src="https://github.com/user-attachments/assets/abc-1" />

https://github.com/user-attachments/assets/0f9e-77aa
`;
    expect(pick(parsePrBody(9336, body))).toEqual([
      {
        kind: "screenshot",
        title: "Completed forecast row with Make it automatic and Undo",
        result: "claimed",
        strength: "attached",
        media: "https://cursor.com/artifacts/c/art-1",
        section: "Screenshots",
      },
      {
        kind: "screenshot",
        title: "After: the same row only has Undo.",
        result: "claimed",
        strength: "attached",
        media: "https://cursor.com/artifacts/c/art-2",
        pairing: "after",
        section: "Screenshots",
      },
      {
        kind: "screenshot",
        title: "Settings page",
        result: "claimed",
        strength: "attached",
        media: "https://github.com/user-attachments/assets/abc-1",
        section: "Screenshots",
      },
      {
        kind: "recording",
        title: "Recording",
        result: "claimed",
        strength: "attached",
        media: "https://github.com/user-attachments/assets/0f9e-77aa",
        section: "Screenshots",
      },
    ]);
  });

  it("takes the before caption from the line above an image with no alt text", () => {
    const body = "## Screenshots\n\nBefore: the old row.\n\n![](https://x.test/a.png)\n";
    expect(parsePrBody(1, body)[0]).toMatchObject({
      title: "Before: the old row.",
      pairing: "before",
    });
  });

  it("reads an end-to-end verdict, even in numbered manual steps", () => {
    const body = `## Testing

### Manual testing

1. Follow the skill.
2. A rep run gives \`feed-e2e shots=28 failures=0 forecast-move=/deals?view=list\`.
3. A broken run gives \`feed-e2e shots=12 failures=3\`.
`;
    const walks = parsePrBody(9343, body).filter((item) => item.kind === "walk");
    expect(walks.map((walk) => [walk.title, walk.result])).toEqual([
      ["feed-e2e shots=28 failures=0 forecast-move=/deals?view=list", "pass"],
      ["feed-e2e shots=12 failures=3", "fail"],
    ]);
  });

  it("reads a Not yet verified list and a section named for the gaps", () => {
    const body = `## Verification

- Backend unit suite and \`just vulture\`.

Not yet verified:
- The full flow on a deployed preview.
- The live view on a real phone.

Known issue: the first Chrome launch is slow.

### What I could not verify

- Twilio quick replies.
`;
    const items = parsePrBody(9660, body);
    expect(items.map((item) => [item.kind, item.title])).toEqual([
      ["test", "Backend unit suite and `just vulture`."],
      ["not-run", "The full flow on a deployed preview."],
      ["not-run", "The live view on a real phone."],
      ["not-run", "Twilio quick replies."],
    ]);
  });

  it("ignores sections that are not about verification, comments and footers", () => {
    expect(parsePrBody(1, TEMPLATE).some((item) => item.title.includes("footer"))).toBe(false);
    expect(parsePrBody(1, TEMPLATE).some((item) => item.section === "Reason for PR")).toBe(false);
    expect(parsePrBody(1, "## Reason\n\n![logo](https://x.test/logo.png)\n")).toEqual([]);
    expect(parsePrBody(1, null)).toEqual([]);
  });

  it("gives the same ids for the same body", () => {
    expect(parsePrBody(1, TEMPLATE).map((item) => item.id)).toEqual(
      parsePrBody(1, TEMPLATE).map((item) => item.id),
    );
  });
});

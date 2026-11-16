import { expect, it } from "vitest";
import type { GitHubPort } from "./port.js";
import { readPrStatus, STATUS_BATCH } from "./pr-status.js";

it("reads the PRs in batches, and leaves out a PR GitHub cannot find", async () => {
  const asked: number[] = [];
  const port = {
    async graphql(_query: string, variables: Record<string, unknown>) {
      const repository: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(variables)) {
        if (!/^n\d+$/.test(key)) continue;
        asked.push(value as number);
        repository[`p${key.slice(1)}`] =
          value === 7
            ? null
            : {
                number: value,
                title: `PR ${value}`,
                state: value === 1 ? "MERGED" : "OPEN",
                isDraft: false,
                reviewDecision: value === 2 ? "CHANGES_REQUESTED" : null,
                commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
              };
      }
      return { repository };
    },
  } as unknown as GitHubPort;
  const numbers = [1, 2, 7, ...Array.from({ length: STATUS_BATCH }, (_, i) => 100 + i), 2];
  const status = await readPrStatus(port, "acme/app", numbers);
  expect(asked).toHaveLength(STATUS_BATCH + 3);
  expect(status.has(7)).toBe(false);
  expect(status.get(1)).toMatchObject({ state: "merged", checks: "failure" });
  expect(status.get(2)).toMatchObject({ state: "open", review: "changes-requested" });
});

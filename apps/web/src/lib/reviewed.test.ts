import type { ChangeSummary } from "@strata/core/model";
import { expect, it } from "vitest";
import { lastOn, reviewedChanges } from "./reviewed";

const change = (id: string, fields: Partial<ChangeSummary>): ChangeSummary => ({
  id,
  title: `Change ${id}`,
  repo: "acme/app",
  input: `acme/app#${id}`,
  status: "done",
  origin: "assigned",
  yours: [],
  waiting: false,
  rootPr: 1,
  tipPr: 1,
  prs: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...fields,
});
const yours = (number: number, seenAt: string) => ({
  number,
  reasons: [{ kind: "reviewed" as const }],
  active: true,
  seenAt,
});
const now = new Date("2026-11-16T12:00:00Z");

it("dates a Change by the newest time GitHub listed your PR on it, else by its last save", () => {
  const seen = change("1", {
    yours: [yours(1, "2026-11-10T00:00:00Z"), yours(2, "2026-11-12T00:00:00Z")],
  });
  expect(lastOn(seen)).toBe("2026-11-12T00:00:00Z");
  expect(lastOn(change("2", { updatedAt: "2026-11-01T00:00:00Z" }))).toBe("2026-11-01T00:00:00Z");
});

it("keeps Changes that do not wait on you, newest first, split at 14 days", () => {
  const list = [
    change("old", { yours: [yours(1, "2026-10-20T00:00:00Z")] }),
    change("new", { yours: [yours(2, "2026-11-15T00:00:00Z")] }),
    change("edge", { yours: [yours(3, "2026-11-02T12:00:00Z")] }),
    change("waiting", { waiting: true, yours: [yours(4, "2026-11-15T00:00:00Z")] }),
    change("added", { origin: "added", updatedAt: "2026-11-15T00:00:00Z" }),
  ];
  const { recent, older } = reviewedChanges(list, now);
  expect(recent.map((c) => c.id)).toEqual(["new", "edge"]);
  expect(older.map((c) => c.id)).toEqual(["old"]);
});

import { describe, it } from "vitest";

/**
 * The shape-invariance benchmark (SPEC.md, "Benchmarks", 1), wired in from the
 * start as CLAUDE.md asks. Milestone 1 turns these into real tests.
 *
 * Fixture plan: a temp git repo where one small feature (a model field, an API
 * route, a UI component, a test, a lockfile bump and a doc) is built twice from
 * the same main: once as a single commit, once as a stack of four commits that
 * includes a mistake a later commit fixes, ending in the same tree. Both are
 * analysed with the same intent source and a deterministic fake LLM.
 */
describe("shape invariance", () => {
  it.todo("one PR and a four-PR stack of the same feature give identical canonical reports");
  it.todo("hints differ between the two runs, proving they exist but do not leak into the output");
  it.todo("reordering files in the diff does not change the report");
  it.todo("PR descriptions never feed the intent ledger");
});

import { describe, expect, it } from "vitest";
import { compareLayers, LAYER_IDS, LAYERS } from "./model/layers.js";

describe("layer definitions", () => {
  it("define every layer once, in review order", () => {
    expect(Object.keys(LAYERS).sort()).toEqual([...LAYER_IDS].sort());
    const ordered = [...LAYER_IDS].sort(compareLayers);
    expect(ordered).toEqual([...LAYER_IDS]);
  });
});

/**
 * Layer classification lands in milestone 1. CLAUDE.md asks for these tests
 * from the start, so the table is here first: each row is a path and the layer
 * a reviewer would expect. Turn each todo into a real case when the rules
 * exist, and add a row whenever a real repo is misclassified.
 */
describe("layer classification", () => {
  it.todo("tests win over UI extensions: src/components/Button.test.tsx → tests");
  it.todo("Beanie models: maverick/data_models/deal.py → data-model");
  it.todo("migrations: migrations/0042_add_index.sql → data-model");
  it.todo("FastAPI routers: maverick/outbound/routers/accounts.py → api");
  it.todo("API schemas: maverick/schemas/crm.py → api");
  it.todo("CI and infra: .github/workflows/ci.yml, Dockerfile_api → config");
  it.todo("frontend: frontend/src/App.tsx → ui");
  it.todo("unmatched code falls back to logic with low confidence");
  it.todo("repo rules run before the defaults");
  it.todo("lockfiles, generated code and snapshots are mechanical and collapsed");
});

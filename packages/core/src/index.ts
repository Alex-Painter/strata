/**
 * @strata/core: the domain model, and (from milestone 1) the deterministic
 * analysis that turns a net diff into a Change: diff parsing, layer rules,
 * mechanical-change detection, diagrams, the intent cross-check and the
 * verdict. Everything here stays pure so it can be tested without git or a
 * network, and so the same input always gives the same Change.
 *
 * The browser imports `@strata/core/model` and `@strata/core/stack` only.
 */
export * from "./change/build.js";
export * from "./change/canonical.js";
export * from "./diff/parse.js";
export * from "./model/index.js";
export * from "./stack/index.js";

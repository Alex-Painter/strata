/**
 * Three-lens cross-check findings (SPEC.md, "The three lenses"). Each finding
 * is a gap between two lenses, and carries the evidence for both sides.
 */
import type { Evidence } from "./change.js";
import type { LayerId } from "./layers.js";

export type Lens = "intent" | "system" | "behaviour";

export type FindingKind =
  /** Behaviour change without intent. */
  | "unintended-side-effect"
  /** Intent without behaviour proof. */
  | "unverified"
  /** System change without intent. */
  | "scope-creep"
  /** System change larger than intent implies. */
  | "design-question";

export type Severity = "blocker" | "warning" | "info";

export interface Finding {
  /** Content-derived from kind and evidence, so it is stable across runs. */
  id: string;
  kind: FindingKind;
  lenses: [Lens, Lens];
  severity: Severity;
  layer?: LayerId;
  title: string;
  detail: string;
  /** Never empty: a finding without evidence is not shown. */
  evidence: Evidence[];
}

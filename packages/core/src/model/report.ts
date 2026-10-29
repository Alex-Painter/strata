/**
 * The ChangeReport is everything one analysis run produced, laid out for
 * progressive disclosure (SPEC.md): verdict, then summary, then evidence, then
 * raw. It is the single payload behind the CLI's static page, the server's
 * workspace view and the chat agent's context.
 */
import type { Change, Evidence } from "./change.js";
import type { ContextSource } from "./context.js";
import type { DataModelDiagram } from "./diagram.js";
import type { Finding } from "./findings.js";
import type { IntentLedger } from "./intent.js";
import type { LayerId } from "./layers.js";
import type { PrPart, Stack } from "./stack.js";

/**
 * 2: the stack, and verdict, ledger and findings became optional.
 * 3: each PR's own diff, and the whole-stack diff as the Change's files.
 * 4: layers and mechanical verdicts on every file and hunk.
 * 5: where each PR's lines went (PrPart.provenance).
 * 6: the Guide, and a summary for the whole stack and for each PR.
 * 7: notes about the split moved to the stack, and each PR's baseOid.
 * 8: the inspect rules each file matched.
 */
export const REPORT_SCHEMA_VERSION = 8;

export type VerdictStatus =
  /** A gate failed or a blocker finding exists. */
  | "blocked"
  /** Findings or mandatory inspections need a human. */
  | "needs-review"
  /** Nothing outstanding that Strata can see. */
  | "ready"
  /** A step was skipped (no intent sources, no LLM, no extractor). */
  | "incomplete";

export interface Verdict {
  status: VerdictStatus;
  /** One line. */
  headline: string;
  /** Lead with the weakest cell, not a single number (SPEC.md). */
  weakest?: { layer?: LayerId; reason: string; evidence: Evidence[] };
}

/** A sentence the product shows. No evidence means it is not shown. */
export interface Claim {
  text: string;
  confidence: "high" | "medium" | "low";
  evidence: Evidence[];
}

/** A section of the Guide: files and hunks of the whole-stack diff to read together. */
export interface GuideSection {
  id: string;
  title: string;
  /** What the section does, each sentence citing its hunks. Empty for Strata's own groups. */
  about: Claim[];
  /** Every file in the section, including ones with no hunks (a binary, a pure rename). */
  paths: string[];
  /** Whole-stack hunk ids, in reading order. */
  hunkIds: string[];
}

/**
 * The order to read the whole stack in, after Linear's Guide. It starts as
 * Strata's own groups (layer, then mechanical kind, then directory); Claude
 * may merge, order and label them, but every hunk stays in exactly one
 * section. Built from the whole-stack diff alone.
 */
export interface Guide {
  /** `rule`: Strata's groups as they are. `llm`: Claude merged, ordered and labelled them. */
  by: "rule" | "llm";
  sections: GuideSection[];
}

export interface LayerSummary {
  layer: LayerId;
  claims: Claim[];
}

export interface ChangeReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  change: Change;
  /**
   * How the code arrived as PRs, for stack inputs. It depends on how the work
   * was split, so it is shown as "How it arrived" and never feeds the
   * whole-stack view.
   */
  stack: Stack | null;
  /** One per PR on the selected path, bottom first; empty without a stack. Also "How it arrived". */
  parts: PrPart[];
  sources: ContextSource[];
  /** Absent until the steps that decide it exist. */
  verdict?: Verdict;
  /** Three to six sentences about the whole stack, from its diff alone. */
  summary: Claim[];
  guide: Guide;
  layerSummaries: LayerSummary[];
  ledger?: IntentLedger;
  findings?: Finding[];
  diagrams: DataModelDiagram[];
  /** Caveats about what this run could not do, shown under the verdict. */
  notes: string[];
  raw: {
    /** The full net diff, for the last level of disclosure. */
    diff: string;
  };
  /** Run metadata. Excluded from shape-invariance comparisons. */
  analysis: {
    engineVersion: string;
    model?: string;
    startedAt: string;
    durationMs: number;
  };
}

/** Drops claims that have no evidence, enforcing AGENTS.md's evidence rule. */
export function evidenced<T extends { evidence: readonly unknown[] }>(items: readonly T[]): T[] {
  return items.filter((item) => item.evidence.length > 0);
}

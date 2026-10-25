/**
 * The intent ledger (SPEC.md, "Interpretations ledger"): requirements pulled
 * from the context sources, and the concrete decisions the agent took them to
 * mean, each with the evidence it was read from.
 */
import type { Evidence } from "./change.js";

export interface Requirement {
  id: string;
  text: string;
  /** Where the requirement is stated. Never empty. */
  evidence: Evidence[];
}

export type InterpretationStatus = "proposed" | "confirmed" | "rejected";

export interface Interpretation {
  id: string;
  requirementId: string;
  /** e.g. "'admins' = org admins, not workspace admins". */
  statement: string;
  /** Ambiguities or conflicts between sources (PRD vs ticket vs transcript). */
  ambiguity?: string;
  alternatives: string[];
  status: InterpretationStatus;
  /** The hunks that implement this interpretation. */
  implementedBy: Evidence[];
  evidence: Evidence[];
}

export interface IntentLedger {
  requirements: Requirement[];
  interpretations: Interpretation[];
}

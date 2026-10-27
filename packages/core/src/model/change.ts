/**
 * The Change: one feature, the top-level object Strata reviews.
 *
 * A Change is built from the *net* diff between its base and head. How the
 * code was split into PRs or commits is kept only as hints (`ChangeHint`), and
 * nothing downstream of `buildChange` may read them when deciding layers,
 * diagrams, interpretations or findings. That is the shape-invariance rule
 * (SPEC.md, "Benchmarks", 1).
 */
import type { Anchor } from "./anchors.js";
import type { InspectFlag, LayerId } from "./layers.js";
import type { StackSeed } from "./stack.js";

/** What the reviewer asked Strata to look at. */
export type ChangeInput =
  /**
   * The stack around a PR or branch, from its bottom PR up to `seed.leaf` or
   * the newest tip above the seed. A PR on its own is a stack of one.
   */
  | { kind: "stack-of"; repo: RepoRef; seed: StackSeed }
  /** An explicit chain, bottom first. It must match the PRs' branch links. */
  | { kind: "stack"; repo: RepoRef; numbers: number[] }
  /** `base...head`: everything on head since it diverged from base. */
  | { kind: "range"; repo: RepoRef; base: string; head: string };

export type RepoRef =
  | { kind: "github"; owner: string; name: string }
  /** A local checkout, used by the CLI and in tests. */
  | { kind: "local"; path: string };

/** The resolved revisions a Change compares. */
export interface ChangeRevisions {
  /** Merge base of the requested base and head. */
  base: string;
  head: string;
}

/** A PR or commit range the code arrived in. A hint, never trusted. */
export interface ChangeHint {
  kind: "pr" | "commit-range";
  label: string;
  url?: string;
  base: string;
  head: string;
}

export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "copied";

export interface FileChange {
  path: string;
  /** Set for renames and copies. */
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  /** Rename/copy similarity reported by git, 0-100. */
  similarity?: number;
  /** File modes when the diff names them: `100644`, `100755`, `120000` (symlink). */
  oldMode?: string;
  newMode?: string;
  /** Ids of this file's hunks, in file order. */
  hunkIds: string[];
  additions: number;
  deletions: number;
  /**
   * Set when the whole file is mechanical (lockfile, generated, binary, pure
   * rename). Files without hunks, like renames and mode changes, only carry
   * their verdict here.
   */
  mechanical: MechanicalVerdict | null;
  /** Layer of the file as a whole; hunks may refine it in future. */
  layer: LayerAssignment;
  /**
   * The inspect rules the file's path matched, in rule order. Always empty in
   * Tests and Docs, for mechanical files, and for a diff built without a
   * classifier.
   */
  inspect: InspectFlag[];
}

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  /** The line without its +/-/space marker. */
  content: string;
  /** Line number on the base side; absent for added lines. */
  oldLine?: number;
  /** Line number on the head side; absent for deleted lines. */
  newLine?: number;
  /** git's "\ No newline at end of file" applied to this line. */
  noNewlineAtEof?: boolean;
}

/** How a hunk was assigned to its layer. */
export interface LayerAssignment {
  layer: LayerId;
  /** `rule` for path/AST rules, `llm` for agent judgement (SPEC.md: rules first). */
  by: "rule" | "llm" | "default";
  /** The rule id or a short reason a reviewer can check. */
  reason: string;
  confidence: "high" | "medium" | "low";
}

export type MechanicalKind =
  | "lockfile"
  | "generated"
  /** Third-party code checked into the repo. */
  | "vendored"
  | "snapshot"
  | "whitespace"
  | "rename"
  | "binary";

/**
 * A change that can be verified mechanically and collapsed, so it neither
 * hides meaningful changes nor depends on how the work was split.
 */
export interface MechanicalVerdict {
  kind: MechanicalKind;
  reason: string;
}

export interface Hunk {
  /** Content-derived: same path and same lines give the same id. */
  id: string;
  path: string;
  /** The `@@ -a,b +c,d @@` numbers. */
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the second `@@`, usually the enclosing function. */
  section: string;
  lines: DiffLine[];
  layer: LayerAssignment;
  /** Null when the hunk is meaningful. */
  mechanical: MechanicalVerdict | null;
}

/** Hunks grouped by layer and then by file, in review order. */
export interface LayerGroup {
  layer: LayerId;
  files: Array<{ path: string; hunkIds: string[] }>;
  meaningfulHunks: number;
  mechanicalHunks: number;
}

export interface Change {
  id: string;
  title: string;
  repo: RepoRef;
  /** Null when git couldn't tell where a stack left its trunk; the stack's issues say why. */
  revisions: ChangeRevisions | null;
  files: FileChange[];
  hunks: Hunk[];
  layers: LayerGroup[];
  hints: ChangeHint[];
}

/** Evidence is just an anchor with a short label for display. */
export interface Evidence {
  anchor: Anchor;
  label: string;
}

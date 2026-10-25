/**
 * Anchors: one way to point at anything in a Change.
 *
 * The workspace shows every kind of context side by side (spec, ticket, PR
 * description, hunks, files, diagrams, findings) and lets the reviewer
 * highlight any of it and ask the agent about it. Evidence links use the same
 * shape. So a highlight on a spec paragraph, a selected line range in a hunk
 * and a click on a diagram entity are all an `Anchor`.
 *
 * Text is addressed the way W3C Web Annotations do it: an exact quote with a
 * little surrounding context, plus character offsets as a hint. Offsets alone
 * break as soon as the text is re-rendered or the source is edited; a quote
 * with context can be found again, which is what lets reviewer notes survive
 * rewrites (SPEC.md, "Agent capabilities").
 *
 * Every anchorable text surface is a list of lines, and its canonical text is
 * those lines joined with "\n". The UI renders one element per line, so it can
 * turn a DOM selection into (line, column) pairs and then into offsets in the
 * canonical text without guessing how the browser serialises line breaks.
 */
import { stableId } from "./ids.js";

export type SourceRef =
  /** One hunk of the Change's net diff. */
  | { kind: "hunk"; hunkId: string }
  /** A whole file at the Change's base or head revision. */
  | { kind: "file"; path: string; side: "base" | "head" }
  /** A context source: spec, ticket, PR description, transcript, note. */
  | { kind: "context"; sourceId: string }
  /** A diagram, or one element (entity, field, relation) inside it. */
  | { kind: "diagram"; diagramId: string; elementId?: string }
  | { kind: "finding"; findingId: string }
  | { kind: "ledger"; entryId: string }
  /** A pull request in the Change's repo. */
  | { kind: "pr"; number: number }
  /** A commit, by full object id. */
  | { kind: "commit"; oid: string };

export type SourceKind = SourceRef["kind"];

export interface TextQuote {
  /** The selected text, verbatim. */
  exact: string;
  /** Up to QUOTE_CONTEXT characters immediately before `exact`. */
  prefix: string;
  /** Up to QUOTE_CONTEXT characters immediately after `exact`. */
  suffix: string;
}

export interface TextRange {
  /** Inclusive start offset in the surface's canonical text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export interface Anchor {
  source: SourceRef;
  /** Absent when the anchor points at the whole source. */
  quote?: TextQuote;
  /** Where the quote was when the anchor was made. A hint, not the truth. */
  range?: TextRange;
}

export const QUOTE_CONTEXT = 32;

/** A key that is equal for equal sources, for maps and React keys. */
export function sourceKey(ref: SourceRef): string {
  switch (ref.kind) {
    case "hunk":
      return `hunk:${ref.hunkId}`;
    case "file":
      return `file:${ref.side}:${ref.path}`;
    case "context":
      return `context:${ref.sourceId}`;
    case "diagram":
      return ref.elementId
        ? `diagram:${ref.diagramId}#${ref.elementId}`
        : `diagram:${ref.diagramId}`;
    case "finding":
      return `finding:${ref.findingId}`;
    case "ledger":
      return `ledger:${ref.entryId}`;
    case "pr":
      return `pr:${ref.number}`;
    case "commit":
      return `commit:${ref.oid}`;
  }
}

export function anchorId(anchor: Anchor): string {
  return stableId(
    "anc",
    sourceKey(anchor.source),
    anchor.quote?.prefix ?? "",
    anchor.quote?.exact ?? "",
    anchor.quote?.suffix ?? "",
  );
}

/** The canonical text of a line-based surface. */
export function surfaceText(lines: readonly string[]): string {
  return lines.join("\n");
}

/** Converts a (line, column) position on a line-based surface to an offset. */
export function lineColumnToOffset(lines: readonly string[], line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  const current = lines[line]?.length ?? 0;
  return offset + Math.max(0, Math.min(column, current));
}

/** Builds a quote anchor for `text.slice(start, end)`. */
export function anchorForRange(source: SourceRef, text: string, range: TextRange): Anchor {
  const start = Math.max(0, Math.min(range.start, range.end, text.length));
  const end = Math.min(text.length, Math.max(range.start, range.end));
  return {
    source,
    quote: {
      exact: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - QUOTE_CONTEXT), start),
      suffix: text.slice(end, end + QUOTE_CONTEXT),
    },
    range: { start, end },
  };
}

/**
 * Finds an anchor's quote in `text`, which may have changed since the anchor
 * was made. Returns null when the quote no longer appears, so callers can show
 * the anchor as orphaned instead of silently pointing at the wrong text.
 *
 * Preference order: the recorded range if it still holds the exact text, then
 * the occurrence whose surrounding text best matches the recorded context.
 */
export function resolveAnchor(anchor: Anchor, text: string): TextRange | null {
  const quote = anchor.quote;
  if (!quote) return { start: 0, end: text.length };
  if (quote.exact.length === 0) return null;

  const hint = anchor.range;
  if (hint && text.slice(hint.start, hint.end) === quote.exact) {
    return { start: hint.start, end: hint.end };
  }

  let best: TextRange | null = null;
  let bestScore = -1;
  for (let at = text.indexOf(quote.exact); at !== -1; at = text.indexOf(quote.exact, at + 1)) {
    const end = at + quote.exact.length;
    const score =
      commonSuffixLength(text.slice(Math.max(0, at - quote.prefix.length), at), quote.prefix) +
      commonPrefixLength(text.slice(end, end + quote.suffix.length), quote.suffix);
    // Ties go to the occurrence nearest the recorded position.
    const nearer =
      best !== null &&
      score === bestScore &&
      hint !== undefined &&
      Math.abs(at - hint.start) < Math.abs(best.start - hint.start);
    if (score > bestScore || nearer) {
      best = { start: at, end };
      bestScore = score;
    }
  }
  return best;
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

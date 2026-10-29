/**
 * What the chat tells Claude about a Change: a digest of the report, and each
 * highlight resolved to a label and the lines around it. Everything here is
 * deterministic and comes from the report, or from git through `readFile`.
 */
import {
  type Anchor,
  type ChangeReport,
  type Hunk,
  hunkSurface,
  LAYERS,
  resolveAnchor,
  surfaceText,
} from "@strata/core";
import type { ResolvedAnchor } from "../api.js";

/** Lines shown before and after a highlight. */
const AROUND = 3;
/** Lines of a file shown when the highlight is the whole file. */
const FILE_LINES = 200;
/** Hunks listed per file in the digest; more are counted only. */
const DIGEST_HUNKS = 20;
/** Files listed in the digest; more are counted only. */
const DIGEST_FILES = 400;

export type ReadFile = (path: string, side: "base" | "head") => Promise<string | null>;

/** A hunk by id: the whole-stack diff first, then each PR's own diff. */
export function findHunk(
  report: ChangeReport,
  id: string,
  pr?: number,
): { hunk: Hunk; pr: number | null } | null {
  if (pr === undefined) {
    const net = report.change.hunks.find((hunk) => hunk.id === id);
    if (net) return { hunk: net, pr: null };
  }
  for (const part of report.parts) {
    if (pr !== undefined && part.pr !== pr) continue;
    const hunk = part.hunks.find((h) => h.id === id);
    if (hunk) return { hunk, pr: part.pr };
  }
  return null;
}

/** Every hunk id the report holds, which are the only ids an answer can cite. */
export function hunkIds(report: ChangeReport): Set<string> {
  return new Set([
    ...report.change.hunks.map((hunk) => hunk.id),
    ...report.parts.flatMap((part) => part.hunks.map((hunk) => hunk.id)),
  ]);
}

const MARK = { add: "+", del: "-", context: " " } as const;

/** A hunk as diff text, its header first. */
export function hunkText(hunk: Hunk, from = 0, to = hunk.lines.length): string {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.section}`;
  const lines = hunk.lines.slice(from, to).map((line) => `${MARK[line.kind]}${line.content}`);
  return [`${hunk.path} ${header}`.trimEnd(), ...lines].join("\n");
}

export async function resolveAnchors(
  report: ChangeReport,
  anchors: Anchor[],
  readFile: ReadFile,
): Promise<ResolvedAnchor[]> {
  return Promise.all(anchors.map((anchor) => resolveOne(report, anchor, readFile)));
}

async function resolveOne(
  report: ChangeReport,
  anchor: Anchor,
  readFile: ReadFile,
): Promise<ResolvedAnchor> {
  const source = anchor.source;
  const quoted = anchor.quote?.exact ?? "";
  switch (source.kind) {
    case "hunk":
    case "pr-hunk": {
      const found = findHunk(
        report,
        source.hunkId,
        source.kind === "pr-hunk" ? source.pr : undefined,
      );
      if (!found) return { anchor, label: `Hunk ${source.hunkId}`, text: quoted, orphaned: true };
      const { hunk, pr } = found;
      const where = pr === null ? "the whole-stack diff" : `the own diff of #${pr}`;
      const lines = hunkSurface(hunk);
      const range = resolveAnchor(anchor, surfaceText(lines));
      if (!range) {
        return { anchor, label: `${hunk.path} (${where})`, text: quoted, orphaned: true };
      }
      const first = lineAt(lines, range.start);
      const last = lineAt(lines, Math.max(range.start, range.end - 1));
      const numbers = hunk.lines
        .slice(first, last + 1)
        .map((line) => line.newLine ?? line.oldLine)
        .filter((n): n is number => n !== undefined);
      const span =
        numbers.length > 0 ? `:${numbers[0]}${numbers.length > 1 ? `-${numbers.at(-1)}` : ""}` : "";
      return {
        anchor,
        label: `${hunk.path}${span} (${where}, ${hunk.id})`,
        text: hunkText(hunk, Math.max(0, first - AROUND), last + 1 + AROUND),
        orphaned: false,
      };
    }
    case "file": {
      const content = await readFile(source.path, source.side);
      const label = `${source.path} (${source.side})`;
      if (content === null) return { anchor, label, text: quoted, orphaned: true };
      const lines = content.split("\n");
      if (!anchor.quote) {
        return { anchor, label, text: numbered(lines, 0, FILE_LINES), orphaned: false };
      }
      const range = resolveAnchor(anchor, content);
      if (!range) return { anchor, label, text: quoted, orphaned: true };
      const first = lineAt(lines, range.start);
      const last = lineAt(lines, Math.max(range.start, range.end - 1));
      return {
        anchor,
        label: `${source.path}:${first + 1}-${last + 1} (${source.side})`,
        text: numbered(lines, Math.max(0, first - AROUND), last + 1 + AROUND),
        orphaned: false,
      };
    }
    case "context": {
      const context = report.sources.find((s) => s.id === source.sourceId);
      if (!context) return { anchor, label: "A context source", text: quoted, orphaned: true };
      const orphaned = anchor.quote ? resolveAnchor(anchor, context.content) === null : false;
      return {
        anchor,
        label: `${context.kind}: ${context.title}`,
        text: anchor.quote ? quoted : context.content,
        orphaned,
      };
    }
    case "pr": {
      const node = report.stack?.nodes.find((n) => n.pr.number === source.number);
      return {
        anchor,
        label: node ? `#${source.number} ${node.pr.title}` : `#${source.number}`,
        text: quoted,
        orphaned: false,
      };
    }
    default:
      return { anchor, label: source.kind, text: quoted, orphaned: false };
  }
}

/** The index of the line that holds `offset` in lines joined by "\n". */
function lineAt(lines: readonly string[], offset: number): number {
  let end = 0;
  for (let i = 0; i < lines.length; i++) {
    end += (lines[i]?.length ?? 0) + 1;
    if (offset < end) return i;
  }
  return Math.max(0, lines.length - 1);
}

function numbered(lines: readonly string[], from: number, to: number): string {
  return lines
    .slice(from, to)
    .map((line, i) => `${String(from + i + 1).padStart(5)}  ${line}`)
    .join("\n");
}

/**
 * The Change as a short text for the system prompt: the PRs on the path, then
 * each layer's files with their hunk ids, then what Claude wrote earlier. No
 * hunk text: Claude reads hunks with a tool when it needs them.
 */
export function digest(report: ChangeReport): string {
  const { change, stack } = report;
  const repo =
    change.repo.kind === "github" ? `${change.repo.owner}/${change.repo.name}` : "a local repo";
  const out = [`# ${change.title}`, `Repo: ${repo}.`];
  if (change.revisions) {
    out.push(`The diff goes from base ${change.revisions.base} to head ${change.revisions.head}.`);
  }
  if (stack) {
    out.push("", "## PRs on this path, bottom first");
    for (const number of stack.selectedPath) {
      const node = stack.nodes.find((n) => n.pr.number === number);
      const part = report.parts.find((p) => p.pr === number);
      out.push(
        `- #${number} ${node?.pr.title ?? ""} (${node?.pr.state ?? "unknown"}; ` +
          `${part ? `${part.hunks.length} hunks in its own diff` : "no diff"})`,
      );
    }
  }
  out.push("", "## Files of the whole-stack diff, by layer");
  const byPath = new Map(change.files.map((file) => [file.path, file]));
  let listed = 0;
  for (const group of change.layers) {
    if (group.files.length === 0) continue;
    out.push(`### ${LAYERS[group.layer].title}`);
    for (const entry of group.files) {
      if (listed++ >= DIGEST_FILES) continue;
      const file = byPath.get(entry.path);
      const counts = file ? ` +${file.additions} -${file.deletions}` : "";
      const mechanical = file?.mechanical ? ` (mechanical: ${file.mechanical.kind})` : "";
      const ids = entry.hunkIds.slice(0, DIGEST_HUNKS).join(", ");
      const more =
        entry.hunkIds.length > DIGEST_HUNKS
          ? ` and ${entry.hunkIds.length - DIGEST_HUNKS} more`
          : "";
      out.push(`- ${entry.path}${counts}${mechanical}: ${ids}${more}`);
    }
  }
  if (listed > DIGEST_FILES) out.push(`(${listed - DIGEST_FILES} more files are not listed.)`);
  if (report.summary.length > 0) {
    out.push("", "## The summary Claude wrote earlier");
    for (const claim of report.summary) out.push(`- ${claim.text}`);
  }
  if (report.guide.sections.length > 0) {
    out.push("", "## The Guide's sections, in reading order");
    for (const section of report.guide.sections) out.push(`- ${section.title}`);
  }
  return out.join("\n");
}

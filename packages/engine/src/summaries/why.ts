/**
 * The why: one to four sentences on why a Change exists, above the numbered
 * summary of what it does.
 *
 * Strata gathers the text that can say why (PR descriptions, the issues the
 * PRs close, commit messages, and the comments and test names the diff adds),
 * cleans it with fixed rules (@strata/core, why/sources.ts) and labels each
 * piece. Claude only writes the sentences. Each sentence cites the labels it
 * rests on and quotes the words that state the reason. A sentence that cites
 * a label Strata did not give, or quotes words that are not in the source, is
 * dropped: no evidence, no claim (AGENTS.md).
 *
 * This text depends on how the work was split, so the request is apart from
 * the whole-stack summary's, which stays the same for every split. It holds no
 * commit ids or line numbers, so a rebase or a restack gets the cached answer.
 * With nothing to read, Claude is not asked.
 */
import {
  type Claim,
  type CodeReason,
  type ContextSource,
  cleanCommitMessage,
  cleanDescription,
  codeReasons,
  type DiffModel,
  type Evidence,
  type Hunk,
  LAYERS,
  normaliseSpace,
  quoteIn,
  stableId,
} from "@strata/core";
import type { CommitMessage } from "../git/diff.js";
import type { PrText } from "../github/verification.js";
import { type AskJson, STE_RULE } from "../llm.js";

/** Bump when the prompt or schema changes, so cached answers aren't reused. */
const PROMPT_VERSION = 1;
const WHY_CLAIMS = 4;
/** Characters per description or issue, and in all, for each kind of source. */
const BODY_CHARS = 4000;
const BODIES_CHARS = 12_000;
const ISSUE_CHARS = 2000;
const ISSUES_CHARS = 4000;
const COMMITS_CHARS = 3000;
const CODE_CHARS = 4000;
const FILES = 200;
/** Characters of a quote kept on its evidence. */
const QUOTE_CHARS = 200;

export interface WhyInput {
  /** `owner/name`, for links to commits and issues. */
  repo: string;
  /** The PRs on the path, bottom first. Empty for a range. */
  prs: PrText[];
  /** The commits on the path or in the range, oldest first. */
  commits: CommitMessage[];
  /** The whole diff, for its files and the comments and test names it adds. */
  whole: DiffModel | null;
}

export interface WhyResult {
  why: Claim[];
  /** The texts the sentences cite, for the report's `sources`. Only cited ones. */
  sources: ContextSource[];
  notes: string[];
}

/** One labelled piece of text in the request. */
interface Piece {
  label: string;
  /** The line above its text in the request. */
  heading: string;
  text: string;
  /** For a description, an issue or a commit: the source it is stored as. */
  source?: ContextSource;
  /** For a hunk: the hunk. */
  hunk?: Hunk;
  /** What its evidence chip reads, such as "#412 description". */
  name: string;
  /** False for a PR title with no body: it names the work, but rarely says why. */
  says: boolean;
}

/** Labels and cleans every source of the why. Pure, so tests can call it. */
export function whyPieces(input: WhyInput): Piece[] {
  const pieces: Piece[] = [];
  const text = (
    kind: ContextSource["kind"],
    key: string,
    title: string,
    url: string,
    content: string,
  ) => ({
    id: stableId("ctx", kind, key, content),
    kind,
    title,
    url,
    content,
    fromPrs: true,
  });

  let bodies = BODIES_CHARS;
  input.prs.forEach((pr, i) => {
    const body = clip(cleanDescription(pr.body), Math.min(BODY_CHARS, bodies));
    bodies -= body.length;
    const content = body ? `${pr.title}\n\n${body}` : pr.title;
    if (!body && pr.title.trim() === "") return;
    pieces.push({
      label: `d${i + 1}`,
      heading: `PR description: ${pr.title}`,
      text: body || "(no description)",
      source: text(
        "pr-description",
        String(pr.number),
        `#${pr.number} ${pr.title}`,
        pr.url,
        content,
      ),
      name: `#${pr.number} description`,
      says: body !== "",
    });
  });

  let issues = ISSUES_CHARS;
  const seen = new Set<number>();
  for (const issue of input.prs.flatMap((pr) => pr.issues)) {
    if (seen.has(issue.number) || issues <= 0) continue;
    seen.add(issue.number);
    const body = clip(cleanDescription(issue.body), Math.min(ISSUE_CHARS, issues));
    issues -= body.length;
    const content = body ? `${issue.title}\n\n${body}` : issue.title;
    pieces.push({
      label: `i${seen.size}`,
      heading: `Issue that the change closes: ${issue.title}`,
      text: body || "(no description)",
      source: text(
        "ticket",
        String(issue.number),
        `#${issue.number} ${issue.title}`,
        issue.url,
        content,
      ),
      name: `#${issue.number} issue`,
      says: true,
    });
  }

  let commits = COMMITS_CHARS;
  const messages = new Set<string>();
  for (const commit of input.commits) {
    const message = cleanCommitMessage(commit.message);
    if (!message || messages.has(message) || message.length > commits) continue;
    messages.add(message);
    commits -= message.length;
    pieces.push({
      label: `c${messages.size}`,
      heading: "Commit message:",
      text: message,
      source: text(
        "commit",
        commit.oid,
        `Commit ${commit.oid.slice(0, 7)}`,
        `https://github.com/${input.repo}/commit/${commit.oid}`,
        message,
      ),
      name: `commit ${commit.oid.slice(0, 7)}`,
      says: true,
    });
  }

  if (input.whole) {
    let code = CODE_CHARS;
    const labels = new Map(input.whole.hunks.map((hunk, i) => [hunk.id, `h${i + 1}`]));
    for (const { hunk, lines } of codeReasons(input.whole.hunks) as CodeReason[]) {
      const body = lines.join("\n");
      if (body.length > code) break;
      code -= body.length;
      const section = hunk.section.trim();
      pieces.push({
        label: labels.get(hunk.id) as string,
        heading: `Comments and test names added in ${hunk.path}${section ? ` @@ ${section}` : ""}:`,
        text: body,
        hunk,
        name: `${hunk.path}:${hunk.newStart}`,
        says: false,
      });
    }
  }
  return pieces;
}

/** Asks Claude why the Change exists. No pieces, no request. */
export async function writeWhy(
  input: WhyInput,
  ask: AskJson,
  signal?: AbortSignal,
): Promise<WhyResult> {
  const pieces = whyPieces(input);
  // PR titles, comments and test names alone rarely say why: they need an author's words to go with.
  if (!pieces.some((piece) => piece.says)) return { why: [], sources: [], notes: [] };
  const files = (input.whole?.files ?? [])
    .slice(0, FILES)
    .map((file) => `  ${file.path} (${LAYERS[file.layer.layer].title})`);
  try {
    const answer = (await ask(
      {
        task: "change-why",
        version: PROMPT_VERSION,
        system: WHY_SYSTEM,
        prompt: [
          "The files that the change touches:",
          files.join("\n") || "  (none)",
          "The sources:",
          pieces.map((piece) => `${piece.label} ${piece.heading}\n${piece.text}`).join("\n\n"),
        ].join("\n\n"),
        schema: WHY_SCHEMA,
        effort: "low",
        maxTokens: 2000,
      },
      signal,
    )) as { why?: unknown } | null;
    return whyClaims(answer?.why, pieces);
  } catch (error) {
    signal?.throwIfAborted();
    return {
      why: [],
      sources: [],
      notes: [`Strata cannot ask Claude why the Change exists. Cause: ${(error as Error).message}`],
    };
  }
}

/**
 * Claude's sentences as claims. A sentence is dropped whole when it cites no
 * label, a label Strata did not give, or a quote that is not in its source.
 */
export function whyClaims(items: unknown, pieces: Piece[]): WhyResult {
  const byLabel = new Map(pieces.map((piece) => [piece.label, piece]));
  const why: Claim[] = [];
  const cited = new Map<string, ContextSource>();
  if (!Array.isArray(items)) return { why, sources: [], notes: [] };
  for (const item of items) {
    if (why.length === WHY_CLAIMS) break;
    const { text, sources } = (item ?? {}) as Record<string, unknown>;
    if (typeof text !== "string" || text.trim() === "" || !Array.isArray(sources)) continue;
    const evidence: Evidence[] = [];
    let trusted = sources.length > 0;
    for (const cite of sources) {
      const { label, quote } = (cite ?? {}) as Record<string, unknown>;
      const piece = typeof label === "string" ? byLabel.get(label.trim()) : undefined;
      const words = typeof quote === "string" ? normaliseSpace(quote) : "";
      if (!piece) {
        trusted = false;
        break;
      }
      if (piece.hunk) {
        evidence.push({
          anchor: { source: { kind: "hunk", hunkId: piece.hunk.id } },
          label: piece.name,
        });
        continue;
      }
      // A reason from an author's text must quote the words that state it.
      if (!words || !quoteIn(words, piece.source?.content ?? piece.text)) {
        trusted = false;
        break;
      }
      const source = piece.source as ContextSource;
      cited.set(source.id, source);
      evidence.push({
        anchor: {
          source: { kind: "context", sourceId: source.id },
          quote: { exact: clip(words, QUOTE_CHARS), prefix: "", suffix: "" },
        },
        label: piece.name,
      });
    }
    if (!trusted || evidence.length === 0) continue;
    // Comments and test names alone are not an author's reason.
    if (!evidence.some((item) => item.anchor.source.kind === "context")) continue;
    why.push({ text: text.trim(), confidence: "medium", evidence });
  }
  return { why, sources: [...cited.values()], notes: [] };
}

function clip(text: string, chars: number): string {
  if (chars <= 0) return "";
  return text.length > chars ? `${text.slice(0, chars - 1).trimEnd()}…` : text;
}

const WHY_SYSTEM = [
  "You help a reviewer understand why a code change exists, before they read what it does.",
  "Strata, the review tool, gives you what the authors wrote about the change, each piece labelled:",
  "PR descriptions (d1, d2, ...), issues that the change closes (i1, ...), commit messages (c1, ...),",
  "and the comments and test names that the diff adds (h1, h2, ...).",
  "",
  "Write one to four sentences on why the change exists: the problem it solves, the need behind it, or what it makes possible.",
  "Most important first. Together they read as one short paragraph.",
  "Only state a reason that a source states. Do not guess at intent, and do not say what the code does unless it explains the reason.",
  "If no source states a reason, return no sentences.",
  "",
  "Every sentence must cite its sources by label, using only the labels given.",
  "For a PR description, an issue or a commit message, quote the exact words from it that state the reason: at most 25 words, copied as they are.",
  "For a comment or a test name (h labels), the quote can be empty. A sentence must cite at least one PR description, issue or commit message.",
  "A sentence whose label or quote is not in the sources is thrown away.",
  "",
  STE_RULE,
].join("\n");

const WHY_SCHEMA = {
  type: "object",
  properties: {
    why: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: { label: { type: "string" }, quote: { type: "string" } },
              required: ["label", "quote"],
              additionalProperties: false,
            },
          },
        },
        required: ["text", "sources"],
        additionalProperties: false,
      },
    },
  },
  required: ["why"],
  additionalProperties: false,
};

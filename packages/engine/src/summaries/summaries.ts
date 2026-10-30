/**
 * The summary, the Guide's sections and a summary for each PR, from Claude.
 *
 * The whole-stack request is built from the whole-stack diff alone: paths,
 * layers, Strata's Guide groups and hunk text. It never names PRs, titles,
 * descriptions, commits or branches, so it is the same byte for byte however
 * the work was split, and so is the answer, which is cached by a hash of the
 * request (llm.ts). Each PR's request is built from that PR's own diff.
 *
 * Claude cites hunks by labels (h1, h2, ...) and groups by labels (g1, g2,
 * ...). A sentence citing a label that wasn't in the request is dropped, and
 * so is one citing nothing: no evidence, no claim (AGENTS.md).
 *
 * This runs only for repos whose settings turn on sendCodeToAnthropic, since
 * it sends file paths and changed lines to the Anthropic API.
 */
import {
  assembleGuide,
  type Claim,
  type DiffModel,
  type FileChange,
  type Guide,
  type GuidePlanSection,
  guideGroups,
  type Hunk,
  LAYERS,
  type PrPart,
  ruleGuide,
  type SourceRef,
} from "@strata/core";
import { runLimited } from "../limit.js";
import { type AskJson, STE_RULE } from "../llm.js";

export interface Summaries {
  /** A short name for the change, from its diff alone, like Linear's stack names. Null without one. */
  name: string | null;
  /** About the whole stack, from its diff alone. */
  summary: Claim[];
  guide: Guide;
  /** By PR number. A PR Claude wasn't asked about, or couldn't answer for, has none. */
  parts: Map<number, Claim[]>;
  /** About the whole-stack summary. */
  notes: string[];
  /** About the PRs' summaries, which depend on how the stack was split. */
  partNotes: string[];
}

/** Bump when a prompt or schema changes, so cached answers aren't reused. */
const PROMPT_VERSION = 3;
/** Characters of hunk text per request. Hunks past it are listed by header only. */
const HUNK_CHARS = 120_000;
/** Lines shown per hunk, and characters per line. */
const LINES_PER_HUNK = 150;
const LINE_CHARS = 200;
const SUMMARY_CLAIMS = 6;
const SECTION_CLAIMS = 2;
const PART_CLAIMS = 3;
/** PR summaries asked for at once. */
const CONCURRENCY = 4;

export async function writeSummaries(
  whole: DiffModel | null,
  parts: Array<Pick<PrPart, "pr" | "how" | "files" | "hunks">>,
  ask: AskJson,
  signal?: AbortSignal,
): Promise<Summaries> {
  const notes: string[] = [];
  const groups = whole ? guideGroups(whole) : [];
  let summary: Claim[] = [];
  let guide = ruleGuide(groups);
  let name: string | null = null;

  if (whole && whole.hunks.length > 0) {
    const hunks = labelHunks(whole.hunks);
    const groupLabels = new Map(groups.map((group, i) => [`g${i + 1}`, group.id]));
    const listing = groups.map((group, i) =>
      [`g${i + 1} ${group.title}`, ...fileLines(group.paths, whole.files, hunks)].join("\n"),
    );
    try {
      const answer = (await ask(
        {
          version: PROMPT_VERSION,
          system: WHOLE_SYSTEM,
          prompt: [
            "Strata's groups of the change's files, in its default reading order:",
            listing.join("\n\n"),
            "The hunks:",
            hunkText(whole.hunks, hunks),
          ].join("\n\n"),
          schema: WHOLE_SCHEMA,
          effort: "medium",
          maxTokens: 16000,
        },
        signal,
      )) as { name?: unknown; summary?: unknown; sections?: unknown } | null;
      name = changeName(answer?.name);
      const cite = (hunk: Hunk): SourceRef => ({ kind: "hunk", hunkId: hunk.id });
      summary = claims(answer?.summary, hunks, cite, SUMMARY_CLAIMS);
      const plan = (Array.isArray(answer?.sections) ? answer.sections : []).flatMap(
        (item): GuidePlanSection[] => {
          const { title, groups: named, about } = (item ?? {}) as Record<string, unknown>;
          if (typeof title !== "string" || !Array.isArray(named)) return [];
          return [
            {
              title,
              groupIds: named.flatMap((label) => {
                const id = typeof label === "string" ? groupLabels.get(label.trim()) : undefined;
                return id ? [id] : [];
              }),
              about: claims(about, hunks, cite, SECTION_CLAIMS),
            },
          ];
        },
      );
      guide = assembleGuide(groups, plan);
    } catch (error) {
      signal?.throwIfAborted();
      notes.push(
        `Strata cannot ask Claude for the summary. Thus the Guide shows Strata's own groups. Cause: ${(error as Error).message}`,
      );
    }
  }

  const byPr = new Map<number, Claim[]>();
  const failures: string[] = [];
  const asked = parts.filter((part) => part.how !== "unknown" && part.hunks.length > 0);
  await runLimited(
    asked.map((part) => async () => {
      const hunks = labelHunks(part.hunks);
      try {
        const answer = (await ask(
          {
            version: PROMPT_VERSION,
            system: PART_SYSTEM,
            prompt: [
              "The files:",
              fileLines(
                part.files.map((file) => file.path),
                part.files,
                hunks,
              ).join("\n"),
              "The hunks:",
              hunkText(part.hunks, hunks),
            ].join("\n\n"),
            schema: PART_SCHEMA,
            effort: "low",
            maxTokens: 4000,
          },
          signal,
        )) as { summary?: unknown } | null;
        const cite = (hunk: Hunk): SourceRef => ({ kind: "pr-hunk", pr: part.pr, hunkId: hunk.id });
        byPr.set(part.pr, claims(answer?.summary, hunks, cite, PART_CLAIMS));
      } catch (error) {
        signal?.throwIfAborted();
        failures.push((error as Error).message);
      }
    }),
    CONCURRENCY,
  );
  const partNotes: string[] = [];
  if (failures.length > 0) {
    const prs = failures.length === 1 ? "1 PR" : `${failures.length} PRs`;
    partNotes.push(`Strata cannot ask Claude to summarise ${prs}. Cause: ${failures[0]}`);
  }

  return { name, summary, guide, parts: byPr, notes, partNotes };
}

const NAME_CHARS = 80;

/** Claude's name for the change, tidied: one line, no full stop, not too long. */
export function changeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().replace(/\.+$/, "");
  if (!name) return null;
  return name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1).trimEnd()}…` : name;
}

/** Labels for a diff's hunks, in diff order: h1, h2, ... */
interface Labels {
  byLabel: Map<string, Hunk>;
  byId: Map<string, string>;
}

function labelHunks(hunks: Hunk[]): Labels {
  const byLabel = new Map<string, Hunk>();
  const byId = new Map<string, string>();
  hunks.forEach((hunk, i) => {
    byLabel.set(`h${i + 1}`, hunk);
    byId.set(hunk.id, `h${i + 1}`);
  });
  return { byLabel, byId };
}

/** One line per file: its path, status, size, layer, and the labels of its hunks. */
function fileLines(paths: string[], files: FileChange[], labels: Labels): string[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return paths.flatMap((path) => {
    const file = byPath.get(path);
    if (!file) return [];
    const facts = [
      file.oldPath ? `${file.status} from ${file.oldPath}` : file.status,
      file.binary ? "binary" : `+${file.additions} -${file.deletions}`,
      LAYERS[file.layer.layer].title,
      ...(file.mechanical ? [`mechanical: ${file.mechanical.reason}`] : []),
    ];
    const hunks = file.hunkIds.map((id) => labels.byId.get(id)).filter(Boolean);
    return [`  ${path} (${facts.join(", ")}): ${hunks.length ? hunks.join(" ") : "no hunks"}`];
  });
}

/**
 * Each hunk under its label and header. Mechanical hunks show the header only,
 * and once the budget is spent the rest do too, so every hunk can still be cited.
 */
function hunkText(hunks: Hunk[], labels: Labels): string {
  let budget = HUNK_CHARS;
  return hunks
    .map((hunk) => {
      const section = hunk.section.trim();
      const header = `${labels.byId.get(hunk.id)} ${hunk.path} @@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${section ? ` ${section}` : ""}`;
      if (hunk.mechanical) return `${header}\n(not shown: ${hunk.mechanical.reason})`;
      const lines = hunk.lines.slice(0, LINES_PER_HUNK).map((line) => {
        const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
        return `${marker}${line.content.slice(0, LINE_CHARS)}`;
      });
      const more = hunk.lines.length - lines.length;
      if (more > 0) lines.push(`(${more} more lines not shown)`);
      const body = lines.join("\n");
      if (body.length > budget)
        return `${header}\n(not shown: the change is too big to show every hunk)`;
      budget -= body.length;
      return `${header}\n${body}`;
    })
    .join("\n\n");
}

/**
 * Claude's sentences as claims. A sentence citing a label Strata didn't give,
 * or no label at all, is dropped whole: its evidence can't be trusted.
 */
function claims(
  items: unknown,
  labels: Labels,
  cite: (hunk: Hunk) => SourceRef,
  limit: number,
): Claim[] {
  if (!Array.isArray(items)) return [];
  const out: Claim[] = [];
  for (const item of items) {
    if (out.length === limit) break;
    const { text, hunks } = (item ?? {}) as Record<string, unknown>;
    if (typeof text !== "string" || text.trim() === "" || !Array.isArray(hunks)) continue;
    const cited = [...new Set(hunks)].map((label) =>
      typeof label === "string" ? labels.byLabel.get(label.trim()) : undefined,
    );
    if (cited.length === 0 || cited.some((hunk) => hunk === undefined)) continue;
    out.push({
      text: text.trim(),
      confidence: "medium",
      evidence: (cited as Hunk[]).map((hunk) => ({
        anchor: { source: cite(hunk) },
        label: `${hunk.path}:${hunk.newStart}`,
      })),
    });
  }
  return out;
}

const CITING = [
  "Every sentence must cite the hunks it rests on by label, using only labels listed below.",
  "A sentence that cites anything else is thrown away.",
  'Hunks marked "not shown" can be cited from their path and header, but claim no more than those show.',
].join("\n");

const WHOLE_SYSTEM = [
  "You help a reviewer read a code change: the net diff of one feature, from where it left the main branch to its end.",
  "Strata, the review tool, has sorted the change's files into groups by layer and directory, and labelled every group (g1, g2, ...) and hunk (h1, h2, ...).",
  "",
  "Write three things.",
  "",
  "0. A name for the change: three to eight words that say what it does, in sentence case, with no full stop,",
  'such as "Cache forecasts per account" or "Add a sources pane to screen queries". The reviewer sees it as the title of the change.',
  "",
  "1. A summary: three to six sentences on what the change does, most important first.",
  "Say what the code does in plain words. Don't praise it, guess at intent the code doesn't show, or count lines.",
  "",
  "2. The Guide: Strata's groups arranged into sections, in the order a reviewer should read them.",
  "Put the core of the change first (its data model, contracts and main logic), and glue code, tests, config and mechanical changes last.",
  "Merge groups that are best read together, and give each section a short title saying what it is about,",
  'such as "Forecast storage" or "Connect the new route". A section may have one or two sentences on what it does.',
  "Use each group once at most. Groups you leave out are shown after your sections, as Strata grouped them.",
  "",
  CITING,
  "",
  STE_RULE,
].join("\n");

const PART_SYSTEM = [
  "You help a reviewer read one pull request's own diff, a step in a larger change.",
  "Strata, the review tool, has labelled every hunk (h1, h2, ...).",
  "",
  "Write one to three sentences on what this diff does, most important first.",
  "Say what the code does in plain words. Don't praise it, guess at intent the code doesn't show, or count lines.",
  "",
  CITING,
  "",
  STE_RULE,
].join("\n");

const CLAIMS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      text: { type: "string" },
      hunks: { type: "array", items: { type: "string" } },
    },
    required: ["text", "hunks"],
    additionalProperties: false,
  },
};

const WHOLE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    summary: CLAIMS_SCHEMA,
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          groups: { type: "array", items: { type: "string" } },
          about: CLAIMS_SCHEMA,
        },
        required: ["title", "groups", "about"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "summary", "sections"],
  additionalProperties: false,
};

const PART_SCHEMA = {
  type: "object",
  properties: { summary: CLAIMS_SCHEMA },
  required: ["summary"],
  additionalProperties: false,
};

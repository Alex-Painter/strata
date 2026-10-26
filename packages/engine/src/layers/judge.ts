/**
 * Asks Claude for the layer of files no rule recognised. Only the whole-stack
 * diff is asked about, and each PR's own diff reuses the answers by path, so a
 * file's layer never depends on how the stack was split. Answers are cached by
 * a hash of the exact request: the same diff gets the same answer on every run,
 * and costs nothing the second time.
 *
 * This runs only for repos whose settings turn on sendCodeToAnthropic, since
 * it sends file paths and changed lines to the Anthropic API.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DiffModel,
  type FileChange,
  type FileStatus,
  type Hunk,
  LAYER_IDS,
  LAYERS,
  type LayerAssignment,
  type LayerId,
} from "@strata/core";
import type { LlmSettings } from "../llm.js";

/** One file Claude is asked about, with the start of its change. */
export interface LayerQuestion {
  path: string;
  status: FileStatus;
  /** Changed lines with their +/- marker, cut to keep the request small. */
  lines: string[];
}

export interface LayerRequest {
  /** Files the rules placed, so Claude can see the repo's conventions. */
  known: Array<{ path: string; layer: LayerId }>;
  files: LayerQuestion[];
}

export interface LayerAnswer {
  path: string;
  layer: LayerId;
  reason: string;
}

/** Returns a layer for some or all of the files asked about. */
export type LayerJudge = (request: LayerRequest, signal?: AbortSignal) => Promise<LayerAnswer[]>;

export class LayerJudgeError extends Error {}

/** Files per request. More would make one slow answer, and one failure cost more. */
const FILES_PER_REQUEST = 40;
/** Changed lines shown per file, and characters per line. */
const LINES_PER_FILE = 30;
const LINE_CHARS = 160;
/** Placed files shown for context. */
const KNOWN_FILES = 200;

/** Bump when the prompt or schema changes, so cached answers aren't reused. */
const PROMPT_VERSION = 1;

/**
 * Asks about every file in the whole-stack diff that only got a guess, and
 * turns the answers into layer assignments. A failed request doesn't fail the
 * run: those files keep their guess and the note says why.
 */
export async function judgeLayers(
  model: DiffModel,
  judge: LayerJudge,
  signal?: AbortSignal,
): Promise<{ judged: Map<string, LayerAssignment>; notes: string[] }> {
  const byId = new Map(model.hunks.map((hunk) => [hunk.id, hunk]));
  const guessed = model.files.filter((file) => file.layer.by === "default" && !file.binary);
  const judged = new Map<string, LayerAssignment>();
  if (guessed.length === 0) return { judged, notes: [] };

  const known = model.files
    .filter((file) => file.layer.by !== "default")
    .slice(0, KNOWN_FILES)
    .map((file) => ({ path: file.path, layer: file.layer.layer }));
  const asked = new Set(guessed.map((file) => file.path));
  const failures: string[] = [];
  let unanswered = 0;

  for (let i = 0; i < guessed.length; i += FILES_PER_REQUEST) {
    const files = guessed.slice(i, i + FILES_PER_REQUEST).map((file) => question(file, byId));
    let answers: LayerAnswer[];
    try {
      answers = await judge({ known, files }, signal);
    } catch (error) {
      signal?.throwIfAborted();
      failures.push((error as Error).message);
      unanswered += files.length;
      continue;
    }
    for (const answer of answers) {
      if (!asked.has(answer.path) || judged.has(answer.path)) continue;
      judged.set(answer.path, {
        layer: answer.layer,
        by: "llm",
        reason: answer.reason,
        confidence: "medium",
      });
    }
  }

  const notes: string[] = [];
  if (failures.length > 0) {
    const files = unanswered === 1 ? "1 file" : `${unanswered} files`;
    notes.push(
      `Strata couldn't ask Claude about ${files}, so their layers are still guesses: ${failures[0]}`,
    );
  }
  return { judged, notes };
}

function question(file: FileChange, byId: Map<string, Hunk>): LayerQuestion {
  const lines: string[] = [];
  for (const id of file.hunkIds) {
    for (const line of byId.get(id)?.lines ?? []) {
      if (line.kind === "context") continue;
      if (lines.length === LINES_PER_FILE) break;
      const marker = line.kind === "add" ? "+" : "-";
      lines.push(`${marker}${line.content.slice(0, LINE_CHARS)}`);
    }
  }
  return { path: file.path, status: file.status, lines };
}

const SYSTEM = [
  "You sort the files of a code change into layers, so a reviewer can read the change one layer at a time.",
  "Strata's path rules didn't recognise these files, so it's asking you.",
  "",
  "The layers, in review order:",
  ...LAYER_IDS.map((id) => `- ${id}: ${LAYERS[id].description}`),
  "",
  "Choose a layer for every file from its path, the start of its change, and the layers of the change's other files.",
  "Give each a reason in one short sentence a reviewer can check against the path or the lines, such as",
  '"Defines the SQLAlchemy model for invoices" or "A nightly job that rebuilds the cache".',
  'Use "other" only when no layer fits.',
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          layer: { type: "string", enum: [...LAYER_IDS] },
          reason: { type: "string" },
        },
        required: ["path", "layer", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["files"],
  additionalProperties: false,
};

function prompt(request: LayerRequest): string {
  const known =
    request.known.length > 0
      ? request.known.map((file) => `${file.path}: ${file.layer}`).join("\n")
      : "(none)";
  const files = request.files
    .map((file) =>
      [`### ${file.path} (${file.status})`, ...file.lines, file.lines.length ? "" : "(no lines)"]
        .join("\n")
        .trimEnd(),
    )
    .join("\n\n");
  return `Files in this change that Strata's rules placed:\n${known}\n\nFiles to sort:\n\n${files}`;
}

/** The judge that asks the Anthropic API, with answers cached under `cacheDir`. */
export function createLlmLayerJudge(llm: LlmSettings, cacheDir: string): LayerJudge {
  return async (request, signal) => {
    const body = {
      model: llm.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user" as const, content: prompt(request) }],
      output_config: {
        effort: "low" as const,
        format: { type: "json_schema" as const, schema: SCHEMA },
      },
    };
    const key = createHash("sha256")
      .update(JSON.stringify({ version: PROMPT_VERSION, body }))
      .digest("hex");
    const path = join(cacheDir, `${key}.json`);
    const cached = await readCached(path);
    if (cached) return validAnswers(cached, request);

    const message = await llm.client.messages.create(body, signal ? { signal } : {});
    if (message.stop_reason === "refusal") {
      throw new LayerJudgeError("Claude declined to answer.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new LayerJudgeError("Claude's answer was cut off.");
    }
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    let answer: unknown;
    try {
      answer = JSON.parse(text.join(""));
    } catch {
      throw new LayerJudgeError("Claude's answer wasn't valid JSON.");
    }
    const answers = validAnswers(answer, request);
    await mkdir(cacheDir, { recursive: true });
    // Written whole, then renamed, so a crash never leaves half an answer.
    await writeFile(`${path}.tmp`, JSON.stringify(answer));
    await rename(`${path}.tmp`, path);
    return answers;
  };
}

/** Null when there's no answer yet, or the file can't be read; either way, Claude is asked. */
async function readCached(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** Keeps answers for files that were asked about, in a real layer, with a reason. */
function validAnswers(answer: unknown, request: LayerRequest): LayerAnswer[] {
  const asked = new Set(request.files.map((file) => file.path));
  const files = (answer as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((item): LayerAnswer[] => {
    const { path, layer, reason } = (item ?? {}) as Record<string, unknown>;
    if (typeof path !== "string" || !asked.has(path)) return [];
    if (!LAYER_IDS.includes(layer as LayerId)) return [];
    if (typeof reason !== "string" || reason.trim() === "") return [];
    return [{ path, layer: layer as LayerId, reason: reason.trim() }];
  });
}

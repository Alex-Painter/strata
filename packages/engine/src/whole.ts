/**
 * The whole Change's diff and what's written about it: the part of a report
 * that must not depend on how the work was split. A stack's runs from where it
 * left the trunk to Strata's last commit on its chain (stack/parts.ts), and a
 * range's from the merge base to the head (range.ts). Both are sorted into
 * layers from the code alone, summarised the same way, and say the same
 * things about what Strata couldn't do, so the same code gives the same
 * whole-stack view either way.
 */
import {
  buildDiff,
  type Classifier,
  createClassifier,
  type DiffModel,
  describeRepo,
  guideGroups,
  type LayerRule,
  type PrPart,
  type RepoRef,
  ruleGuide,
} from "@strata/core";
import { diffText, readBlob } from "./git/diff.js";
import { judgeLayers, type LayerJudge } from "./layers/judge.js";
import type { AskJson } from "./llm.js";
import type { RepoSettings } from "./settings.js";
import { type Summaries, writeSummaries } from "./summaries/summaries.js";

export interface WholeDiff {
  from: string;
  to: string;
  diff: string;
  model: DiffModel;
}

export interface WholeDiffOptions {
  /** The repo's own layer rules, from its settings. */
  repoRules?: readonly LayerRule[];
  /** Asks Claude about files no rule matched. Only set when the repo allows it. */
  judge?: LayerJudge | null;
  signal?: AbortSignal;
}

/**
 * Diffs `from` to `to` and sorts it into layers with the repo's rules, its
 * .gitattributes at `to`, and Claude's answers about files no rule matched.
 * The classifier comes back too, so a stack's PRs are sorted the same way.
 * Without both ends there's no diff, only the classifier at whichever exists.
 */
export async function buildWholeDiff(
  gitDir: string,
  from: string | null,
  to: string | null,
  options: WholeDiffOptions = {},
): Promise<{ whole: WholeDiff | null; classifier: Classifier; layerNotes: string[] }> {
  const top = to ?? from;
  const rules = {
    repoRules: options.repoRules ?? [],
    gitattributes: top ? await readBlob(gitDir, top, ".gitattributes") : null,
  };
  let classifier = createClassifier(rules);
  const layerNotes: string[] = [];
  if (!from || !to) return { whole: null, classifier, layerNotes };

  const diff = await diffText(gitDir, from, to);
  let model = buildDiff(diff, { classifier });
  if (options.judge) {
    const { judged, notes } = await judgeLayers(model, options.judge, options.signal);
    layerNotes.push(...notes);
    if (judged.size > 0) {
      classifier = createClassifier({ ...rules, judged });
      model = buildDiff(diff, { classifier });
    }
  }
  return { whole: { from, to, diff, model }, classifier, layerNotes };
}

/** What the repo's settings let Claude do for one run. */
export interface ClaudeSteps {
  settings: RepoSettings;
  /** Null unless the repo's settings let its code go to Claude and there's a key. */
  judge: LayerJudge | null;
  /** Asks Claude for the summaries. Null when the judge would be. */
  ask: AskJson | null;
}

/** Claude's summaries when the repo allows them; otherwise Strata's own Guide and none. */
export async function summarise(
  whole: DiffModel | null,
  parts: Array<Pick<PrPart, "pr" | "how" | "files" | "hunks">>,
  steps: ClaudeSteps,
  options: { onProgress?: (step: string) => void; signal?: AbortSignal },
): Promise<Summaries> {
  if (steps.ask) {
    options.onProgress?.("Claude writes the summaries");
    return writeSummaries(whole, parts, steps.ask, options.signal);
  }
  const groups = whole ? guideGroups(whole) : [];
  return {
    name: null,
    summary: [],
    guide: ruleGuide(groups),
    parts: new Map(),
    notes: [],
    partNotes: [],
  };
}

/** Says what Strata guessed or skipped about the whole diff, and how to change that. */
export function wholeNotes(repo: RepoRef, whole: DiffModel | null, steps: ClaudeSteps): string[] {
  if (!whole) return [];
  const settings = `settings/${describeRepo(repo)}.json in Strata's data folder`;
  const notes: string[] = [];
  const guessed = whole.files.filter((file) => file.layer.by === "default");
  if (!steps.judge && guessed.length > 0) {
    const one = guessed.length === 1;
    const files = one ? "the layer of 1 file" : `the layers of ${guessed.length} files`;
    notes.push(
      steps.settings.sendCodeToAnthropic
        ? `Strata guessed ${files}. This repo lets Claude sort ${one ? "it" : "them"}, but Strata does not have an Anthropic API key.`
        : `Strata guessed ${files}. To put ${one ? "it" : "them"} in a layer, add layer rules or turn on ` +
            `sendCodeToAnthropic in ${settings}.`,
    );
  }
  if (!steps.ask) {
    const without = "There is no summary, and the Guide shows Strata's own groups";
    notes.push(
      steps.settings.sendCodeToAnthropic
        ? `${without}. This repo lets Claude write them, but Strata does not have an Anthropic API key.`
        : `${without}. To let Claude write them, turn on sendCodeToAnthropic in ${settings}.`,
    );
  }
  return notes;
}

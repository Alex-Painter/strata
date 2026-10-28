/**
 * A commit range as a Change: everything on `head` since it left `base`, as
 * `git diff base...head` shows it. There's no stack and no PRs, so it's the
 * plainest input there is, and a stack's whole-stack view must come out the
 * same as the range over the same code (the shape-invariance check).
 *
 * Ranges are read from Strata's own copy of a GitHub repo, so a commit id has
 * to be on a branch, or have been fetched for a PR Strata analysed.
 */
import {
  type ChangeInput,
  ChangeInputError,
  type ChangeReport,
  type ChangeRevisions,
  describeRepo,
  REPORT_SCHEMA_VERSION,
  stableId,
} from "@strata/core";
import type { AnalyzeOptions, ResolvedChange } from "./api.js";
import type { RepoCache } from "./git/cache.js";
import { mergeBase, resolveCommit } from "./git/diff.js";
import { buildWholeDiff, type ClaudeSteps, summarise, wholeNotes } from "./whole.js";

export type RangeInput = Extract<ChangeInput, { kind: "range" }>;

export async function resolveRangeChange(
  input: RangeInput,
  cache: RepoCache,
): Promise<ResolvedChange & { revisions: ChangeRevisions }> {
  await cache.fetch({ pulls: [] });
  const repo = describeRepo(input.repo);
  const [base, head] = await Promise.all(
    [input.base, input.head].map((ref) => resolveCommit(cache.gitDir, ref)),
  );
  for (const [ref, oid] of [
    [input.base, base],
    [input.head, head],
  ] as const) {
    if (!oid) {
      throw new ChangeInputError(
        `Strata's copy of ${repo} has no ${ref}. Use a branch, or a commit on a branch.`,
      );
    }
  }
  const start = await mergeBase(cache.gitDir, base as string, head as string);
  if (!start) {
    throw new ChangeInputError(`${input.base} and ${input.head} do not have one merge base.`);
  }
  const label = `${input.base}...${input.head}`;
  return {
    repo: input.repo,
    gitDir: cache.gitDir,
    revisions: { base: start, head: head as string },
    title: label,
    hints: [{ kind: "commit-range", label, base: start, head: head as string }],
    prDescriptions: [],
    stack: null,
  };
}

export async function rangeReport(
  resolved: ResolvedChange & { revisions: ChangeRevisions },
  options: AnalyzeOptions,
  meta: ClaudeSteps & { engineVersion: string; startedAt: Date; model?: string },
): Promise<ChangeReport> {
  const { base, head } = resolved.revisions;
  const { whole, layerNotes } = await buildWholeDiff(resolved.gitDir, base, head, {
    repoRules: meta.settings.layerRules,
    judge: meta.judge,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const model = whole?.model ?? null;
  const summaries = await summarise(model, [], meta, options);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    change: {
      id: stableId("chg", describeRepo(resolved.repo), base, head),
      title: resolved.title,
      repo: resolved.repo,
      revisions: { base, head },
      files: model?.files ?? [],
      hunks: model?.hunks ?? [],
      layers: model?.layers ?? [],
      hints: resolved.hints,
    },
    stack: null,
    parts: [],
    sources: options.sources ?? [],
    summary: summaries.summary,
    guide: summaries.guide,
    layerSummaries: [],
    diagrams: [],
    notes: [...layerNotes, ...wholeNotes(resolved.repo, model, meta), ...summaries.notes],
    raw: { diff: whole?.diff ?? "" },
    analysis: {
      engineVersion: meta.engineVersion,
      ...(meta.ask && meta.model ? { model: meta.model } : {}),
      startedAt: meta.startedAt.toISOString(),
      durationMs: Date.now() - meta.startedAt.getTime(),
    },
  };
}

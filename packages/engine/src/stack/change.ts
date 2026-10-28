/**
 * Turns a stack input into a Change: find the stack, pick the path, build
 * each PR's diff and the whole-stack diff, sort them into layers, and
 * describe it. Claude writes the summaries and orders the Guide when the
 * repo's settings allow it; otherwise the Guide is Strata's own groups and
 * the report says why there's no summary.
 */
import {
  type ChangeHint,
  type ChangeInput,
  type ChangeReport,
  describeRepo,
  linkedGroups,
  type PrIndex,
  REPORT_SCHEMA_VERSION,
  type Stack,
  type StackSeed,
  stableId,
} from "@strata/core";
import type { AnalyzeOptions, ResolvedChange } from "../api.js";
import type { RepoCache } from "../git/cache.js";
import { type ClaudeSteps, summarise, wholeNotes } from "../whole.js";
import { buildStackDiffs, type StackDiffs } from "./parts.js";
import { resolveStack } from "./resolve.js";

export type StackInput = Extract<ChangeInput, { kind: "stack-of" | "stack" }>;

export class StackInputError extends Error {}

/** The PR heads to fetch before building the stack around `seed`. */
export function pullsFor(index: PrIndex, seed: StackSeed): number[] {
  const seeds = index.prs
    .filter((pr) => ("pr" in seed ? pr.number === seed.pr : pr.headRef === seed.branch))
    .map((pr) => pr.number);
  const groups = linkedGroups(index).filter((group) => group.some((n) => seeds.includes(n)));
  return [...new Set([...seeds, ...groups.flat()])].sort((a, b) => a - b);
}

export async function resolveStackChange(
  input: StackInput,
  index: PrIndex,
  cache: RepoCache,
): Promise<ResolvedChange & { stack: Stack }> {
  const seed: StackSeed =
    input.kind === "stack-of"
      ? input.seed
      : { pr: input.numbers[0] as number, leaf: input.numbers[input.numbers.length - 1] as number };
  await cache.fetch({ pulls: pullsFor(index, seed) });
  const stack = await resolveStack(index, seed, cache.gitDir);
  if (input.kind === "stack" && stack.selectedPath.join(",") !== input.numbers.join(",")) {
    throw new StackInputError(
      `${input.numbers.map((n) => `#${n}`).join(", ")} is not a chain of branch links. ` +
        `The stack through #${input.numbers[0]} is ${describePath(stack.selectedPath)}.`,
    );
  }

  const nodes = new Map(stack.nodes.map((node) => [node.pr.number, node]));
  const path = stack.selectedPath.map((n) => nodes.get(n)).filter((node) => node !== undefined);
  const tip = path[path.length - 1];
  const root = path[0];
  if (!root || !tip) throw new StackInputError("The stack has no PRs.");
  const hints: ChangeHint[] = path.flatMap((node) =>
    node.anchor
      ? [
          {
            kind: "pr" as const,
            label: `#${node.pr.number} ${node.pr.title}`,
            url: node.pr.url,
            base: node.anchor,
            head: node.pr.headOid,
          },
        ]
      : [],
  );
  return {
    repo: input.repo,
    gitDir: cache.gitDir,
    revisions: stack.base ? { base: stack.base, head: tip.pr.headOid } : null,
    title: root.pr.title,
    hints,
    // PR descriptions aren't in the index yet.
    prDescriptions: [],
    stack,
  };
}

export async function stackReport(
  resolved: ResolvedChange & { stack: Stack },
  options: AnalyzeOptions,
  meta: ClaudeSteps & {
    engineVersion: string;
    startedAt: Date;
    /** The model `ask` uses. */
    model?: string;
  },
): Promise<ChangeReport> {
  const diffs = await buildStackDiffs(resolved.stack, resolved.gitDir, {
    repoRules: meta.settings.layerRules,
    judge: meta.judge,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const whole = diffs.whole;
  const summaries = await summarise(whole?.model ?? null, diffs.parts, meta, options);
  // Notes that depend on how the work was split go on the stack, out of the whole-stack view.
  const stack: Stack = {
    ...resolved.stack,
    issues: [...resolved.stack.issues, ...diffs.issues],
    notes: [...diffNotes(resolved.stack, diffs), ...summaries.partNotes],
  };
  const path = stack.selectedPath;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    change: {
      id: stableId(
        "chg",
        describeRepo(resolved.repo),
        String(path[0]),
        String(path[path.length - 1]),
      ),
      title: resolved.title,
      repo: resolved.repo,
      revisions: whole ? { base: whole.from, head: whole.to } : null,
      files: whole?.model.files ?? [],
      hunks: whole?.model.hunks ?? [],
      layers: whole?.model.layers ?? [],
      hints: resolved.hints,
    },
    stack,
    parts: diffs.parts.map((part) => ({ ...part, summary: summaries.parts.get(part.pr) ?? [] })),
    sources: options.sources ?? [],
    summary: summaries.summary,
    guide: summaries.guide,
    layerSummaries: [],
    diagrams: [],
    notes: [
      ...diffs.layerNotes,
      ...wholeNotes(resolved.repo, whole?.model ?? null, meta),
      ...summaries.notes,
    ],
    raw: { diff: whole?.diff ?? "" },
    analysis: {
      engineVersion: meta.engineVersion,
      ...(meta.ask && meta.model ? { model: meta.model } : {}),
      startedAt: meta.startedAt.toISOString(),
      durationMs: Date.now() - meta.startedAt.getTime(),
    },
  };
}

/** Says when the whole-stack diff doesn't cover the whole path. */
function diffNotes(stack: Stack, diffs: StackDiffs): string[] {
  const path = stack.selectedPath;
  if (!stack.base) {
    return [
      `Strata cannot find where the stack left ${stack.trunk.name}. Thus there are no diffs.`,
    ];
  }
  if (!diffs.whole) {
    return [
      `Strata cannot put #${path[0]} on ${stack.trunk.name}. Thus there is no whole-stack diff.`,
    ];
  }
  if (diffs.placed.length < path.length) {
    const left = path.filter((n) => !diffs.placed.includes(n));
    return [
      `The whole-stack diff covers ${describePath(diffs.placed)} only. ` +
        `${describePrs(left)} ${left.length === 1 ? "is not" : "are not"} in it. The stack's issues give the cause.`,
    ];
  }
  return [];
}

function describePrs(numbers: number[]): string {
  const refs = numbers.map((n) => `#${n}`);
  return refs.length <= 2
    ? refs.join(" and ")
    : `${refs.slice(0, -1).join(", ")} and ${refs.at(-1)}`;
}

function describePath(path: number[]): string {
  return path.map((n) => `#${n}`).join(" → ");
}

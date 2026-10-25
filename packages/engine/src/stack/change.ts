/**
 * Turns a stack input into a Change: find the stack, pick the path, and
 * describe it. Diffs, layers and summaries come in later slices, so for now
 * the report carries the stack and says what it doesn't have yet.
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
): Promise<ResolvedChange> {
  const seed: StackSeed =
    input.kind === "stack-of"
      ? input.seed
      : { pr: input.numbers[0] as number, leaf: input.numbers[input.numbers.length - 1] as number };
  await cache.fetch({ pulls: pullsFor(index, seed) });
  const stack = await resolveStack(index, seed, cache.gitDir);
  if (input.kind === "stack" && stack.selectedPath.join(",") !== input.numbers.join(",")) {
    throw new StackInputError(
      `${input.numbers.map((n) => `#${n}`).join(", ")} isn't a chain of branch links. ` +
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

export function stackReport(
  resolved: ResolvedChange & { stack: Stack },
  options: AnalyzeOptions,
  meta: { engineVersion: string; startedAt: Date },
): ChangeReport {
  const { stack } = resolved;
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
      revisions: resolved.revisions,
      files: [],
      hunks: [],
      layers: [],
      hints: resolved.hints,
    },
    stack,
    sources: options.sources ?? [],
    summary: [],
    layerSummaries: [],
    diagrams: [],
    notes: ["Strata found the stack. Diffs, layers and summaries aren't computed yet."],
    raw: { diff: "" },
    analysis: {
      engineVersion: meta.engineVersion,
      startedAt: meta.startedAt.toISOString(),
      durationMs: Date.now() - meta.startedAt.getTime(),
    },
  };
}

function describePath(path: number[]): string {
  return path.map((n) => `#${n}`).join(" → ");
}

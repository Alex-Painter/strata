/**
 * Each PR's own diff, and the whole-stack diff, built on Strata's own chain of
 * commits (see PrPart in core's model/stack.ts). For each PR on the path, bottom
 * first:
 *
 * - If the stack so far has the same code as the PR's anchor, the PR's head
 *   goes on top as it is (`direct`).
 * - Otherwise its changes since the anchor are merged onto the stack so far,
 *   as a restack would (`replayed`).
 * - If that merge conflicts, the chain stops there. That PR and the ones above
 *   it get their diff from anchor to head (`apart`), and the whole-stack diff
 *   ends at the PR below.
 *
 * The chain's commits only differ from a real restack in their author, date
 * and message, so the whole-stack diff is the same however the work was split.
 *
 * Every diff is then sorted into layers by one classifier, built from the
 * whole stack: the repo's rules, its .gitattributes at the top of the stack,
 * and, when the repo allows it, Claude's layers for the whole-stack files no
 * rule matched.
 */
import {
  buildDiff,
  createClassifier,
  type DiffModel,
  type Evidence,
  type FileChange,
  type GitHubDiffCheck,
  type LayerRule,
  type PrPart,
  type Stack,
  type StackEdge,
  type StackIssue,
  type StackNode,
} from "@strata/core";
import {
  branchTip,
  commitTree,
  diffText,
  mergeBase,
  readBlob,
  replay,
  treeOf,
} from "../git/diff.js";
import { judgeLayers, type LayerJudge } from "../layers/judge.js";
import { buildProvenance } from "./provenance.js";

export interface StackDiffs {
  parts: PrPart[];
  /** From where the stack left the trunk to the last PR placed. Null when no PR could be. */
  whole: { from: string; to: string; diff: string; model: DiffModel } | null;
  /** Replay conflicts. They belong with the stack's own issues. */
  issues: StackIssue[];
  /** The PRs the whole-stack diff covers, bottom first. */
  placed: number[];
  /** Anything the report should say about how files were sorted into layers. */
  layerNotes: string[];
}

export interface StackDiffOptions {
  /** The repo's own layer rules, from its settings. */
  repoRules?: readonly LayerRule[];
  /** Asks Claude about files no rule matched. Only set when the repo allows it. */
  judge?: LayerJudge | null;
  signal?: AbortSignal;
}

/** Where one PR's diff starts and ends, before it's read. */
type Step = Pick<PrPart, "pr" | "how" | "from" | "to">;

export async function buildStackDiffs(
  stack: Stack,
  gitDir: string,
  options: StackDiffOptions = {},
): Promise<StackDiffs> {
  const nodes = new Map(stack.nodes.map((node) => [node.pr.number, node]));
  const edges = new Map(stack.edges.map((edge) => [edge.child, edge]));
  const steps: Step[] = [];
  const issues: StackIssue[] = [];
  const placed: number[] = [];
  // The stack so far, as Strata's own commit. Null once a PR couldn't be placed.
  let at: string | null = stack.base;
  let end: string | null = null;

  for (const number of stack.selectedPath) {
    const node = nodes.get(number) as StackNode;
    const head = node.pr.headOid;
    if (!node.anchor) {
      steps.push({ pr: number, how: "unknown", from: null, to: null });
      at = null;
      continue;
    }
    if (at === null) {
      steps.push({ pr: number, how: "apart", from: node.anchor, to: head });
      continue;
    }
    const direct = (await treeOf(gitDir, at)) === (await treeOf(gitDir, node.anchor));
    const result = direct
      ? ({ kind: "clean", tree: await treeOf(gitDir, head) } as const)
      : await replay(gitDir, node.anchor, at, head);
    if (result.kind === "conflict") {
      issues.push(conflictIssue(node, edges.get(number) ?? null, placed, result.paths));
      steps.push({ pr: number, how: "apart", from: node.anchor, to: head });
      at = null;
      continue;
    }
    const to = await commitTree(gitDir, result.tree, at, `#${number}`);
    steps.push({ pr: number, how: direct ? "direct" : "replayed", from: at, to });
    placed.push(number);
    at = to;
    end = to;
  }

  // The repo's .gitattributes as the whole stack leaves it, so every diff is
  // classified the same way however the work was split.
  const top = end ?? stack.base;
  const rules = {
    repoRules: options.repoRules ?? [],
    gitattributes: top ? await readBlob(gitDir, top, ".gitattributes") : null,
  };
  let classifier = createClassifier(rules);
  let whole: StackDiffs["whole"] = null;
  const layerNotes: string[] = [];
  if (stack.base && end) {
    const diff = await diffText(gitDir, stack.base, end);
    let model = buildDiff(diff, { classifier });
    if (options.judge) {
      const { judged, notes } = await judgeLayers(model, options.judge, options.signal);
      layerNotes.push(...notes);
      if (judged.size > 0) {
        classifier = createClassifier({ ...rules, judged });
        model = buildDiff(diff, { classifier });
      }
    }
    whole = { from: stack.base, to: end, diff, model };
  }

  const built: Array<Omit<PrPart, "provenance">> = [];
  for (const step of steps) {
    const node = nodes.get(step.pr) as StackNode;
    const { files, hunks } =
      step.from && step.to
        ? buildDiff(await diffText(gitDir, step.from, step.to), { classifier })
        : { files: [], hunks: [] };
    const part = { ...step, files, hunks };
    const edge = edges.get(step.pr) ?? null;
    const github =
      node.pr.state === "open" ? await compareWithGitHub(gitDir, stack, node, edge, part) : null;
    built.push({ ...part, github });
  }

  const chain = steps.flatMap((step) =>
    (step.how === "direct" || step.how === "replayed") && step.to
      ? [{ pr: step.pr, commit: step.to }]
      : [],
  );
  const provenance =
    stack.base && whole
      ? await buildProvenance(gitDir, stack.base, chain, whole.model, built)
      : new Map();
  const parts: PrPart[] = built.map((part) => ({
    ...part,
    provenance: provenance.get(part.pr) ?? null,
  }));
  return { parts, whole, issues, placed, layerNotes };
}

function conflictIssue(
  node: StackNode,
  edge: StackEdge | null,
  placed: number[],
  paths: string[],
): StackIssue {
  const n = node.pr.number;
  const below = placed[placed.length - 1];
  const files = paths.length === 1 ? paths[0] : `${paths.length} files`;
  return {
    kind: "replay-conflict",
    prs: [n],
    message:
      below === undefined
        ? `#${n}'s changes conflict with where the stack left the trunk (${files}), so there's no whole-stack diff.`
        : `#${n}'s changes conflict with the stack below it (${files}), so the whole-stack diff stops at #${below}.`,
    evidence: [
      commitEvidence(node.anchor as string, `where #${n}'s changes start`),
      commitEvidence(node.pr.headOid, `#${n}'s head`),
      ...(edge?.evidence ?? []),
    ],
  };
}

/**
 * GitHub diffs a PR from the merge base of its head and its base branch's tip.
 * Strata's diff starts at the stack below the PR, so the two agree while the PR
 * sits on its parent's head.
 */
async function compareWithGitHub(
  gitDir: string,
  stack: Stack,
  node: StackNode,
  edge: StackEdge | null,
  part: Omit<PrPart, "github" | "provenance">,
): Promise<GitHubDiffCheck | null> {
  if (part.how === "unknown") return null;
  const { pr } = node;
  const tip = await branchTip(gitDir, pr.baseRef);
  const base = tip ? await mergeBase(gitDir, tip, pr.headOid) : null;
  if (!base) return null;

  const theirs = buildDiff(await diffText(gitDir, base, pr.headOid)).files;
  const theirPaths = new Set(theirs.map((file) => file.path));
  const ourPaths = new Set(part.files.map((file) => file.path));
  const same =
    theirs.length === part.files.length &&
    theirs.every((file, i) => fileKey(file) === fileKey(part.files[i] as FileChange));
  // Strata's own commits aren't on GitHub, so its side is shown by the PR's
  // anchor: the same code for a direct part, and where the replay started otherwise.
  const anchor = node.anchor as string;
  const evidence: Evidence[] = [
    commitEvidence(base, `where GitHub's diff of #${pr.number} starts`),
    commitEvidence(
      anchor,
      part.how === "direct" ? "where Strata's starts" : `where #${pr.number}'s changes start`,
    ),
  ];
  return {
    base,
    same,
    onlyOnGitHub: [...theirPaths].filter((path) => !ourPaths.has(path)),
    onlyHere: [...ourPaths].filter((path) => !theirPaths.has(path)),
    reason: same ? null : differsBecause(stack, node, edge, part),
    evidence,
  };
}

/** What makes two diffs of one file the same: its paths, status, modes and hunks. */
function fileKey(file: FileChange): string {
  return [
    file.path,
    file.oldPath ?? "",
    file.status,
    file.oldMode ?? "",
    file.newMode ?? "",
    file.hunkIds.join(","),
  ].join("\u0000");
}

function differsBecause(
  stack: Stack,
  node: StackNode,
  edge: StackEdge | null,
  part: Omit<PrPart, "github" | "provenance">,
): string {
  const n = `#${node.pr.number}`;
  const baseRef = node.pr.baseRef;
  if (part.how === "apart") {
    return `${n} couldn't be put on the stack below it, so Strata shows its changes since it branched, and GitHub diffs it from ${baseRef}.`;
  }
  const parent = edge ? stack.nodes.find((other) => other.pr.number === edge.parent) : undefined;
  const p = parent ? `#${parent.pr.number}` : null;
  switch (edge?.link) {
    case "intact":
      if (parent?.pr.state === "merged") {
        return `${p} landed on ${parent.pr.baseRef} as a new commit, and ${n} hasn't been rebased since, so GitHub's diff of ${n} repeats ${p}'s changes.`;
      }
      break;
    case "behind":
      return `${n} is behind ${p}, so GitHub diffs it from where it left ${p}, and Strata from ${p}'s head now.`;
    case "stale":
      return `${p} was force-pushed after ${n} branched from it, so GitHub diffs ${n} from the old ${p}, and Strata from ${p}'s head now.`;
    case "re-anchored":
      return `${n} now sits on ${baseRef} rather than on ${p}, so GitHub diffs it from ${baseRef}, and Strata from the stack below it.`;
  }
  if (part.how === "replayed") {
    return `A PR below ${n} was replayed onto newer code, so Strata diffs ${n} from that, and GitHub from ${baseRef}.`;
  }
  return `GitHub diffs ${n} from where it meets ${baseRef}, and Strata from the stack below it.`;
}

function commitEvidence(oid: string, label: string): Evidence {
  return { anchor: { source: { kind: "commit", oid } }, label };
}

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
  type Evidence,
  type FileChange,
  type GitHubDiffCheck,
  type PrPart,
  type Stack,
  type StackEdge,
  type StackIssue,
  type StackNode,
} from "@strata/core";
import { branchTip, commitTree, diffText, mergeBase, replay, treeOf } from "../git/diff.js";
import { buildWholeDiff, type WholeDiff, type WholeDiffOptions } from "../whole.js";
import { buildProvenance } from "./provenance.js";

export interface StackDiffs {
  parts: PrPart[];
  /** From where the stack left the trunk to the last PR placed. Null when no PR could be. */
  whole: WholeDiff | null;
  /** Replay conflicts. They belong with the stack's own issues. */
  issues: StackIssue[];
  /** The PRs the whole-stack diff covers, bottom first. */
  placed: number[];
  /** Anything the report should say about how files were sorted into layers. */
  layerNotes: string[];
}

export type StackDiffOptions = WholeDiffOptions;

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

  // Classified with the repo's .gitattributes as the whole stack leaves it, so
  // every diff is sorted the same way however the work was split.
  const { whole, classifier, layerNotes } = await buildWholeDiff(gitDir, stack.base, end, options);

  const built: Array<Omit<PrPart, "provenance" | "summary">> = [];
  for (const step of steps) {
    const node = nodes.get(step.pr) as StackNode;
    const { files, hunks } =
      step.from && step.to
        ? buildDiff(await diffText(gitDir, step.from, step.to), { classifier })
        : { files: [], hunks: [] };
    const part = { ...step, files, hunks };
    const edge = edges.get(step.pr) ?? null;
    const github = await compareWithGitHub(gitDir, stack, node, edge, part);
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
    // Claude's summary of the part's own diff comes later, when the repo allows it.
    summary: [],
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
  part: Omit<PrPart, "github" | "provenance" | "summary">,
): Promise<GitHubDiffCheck | null> {
  if (part.how === "unknown") return null;
  const { pr } = node;
  // GitHub diffs an open PR from its base branch now, and a merged or closed one
  // from where that branch was when it merged or closed.
  const from = pr.state === "open" ? await branchTip(gitDir, pr.baseRef) : pr.baseOid;
  const base = from ? await mergeBase(gitDir, from, pr.headOid) : null;
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
    reason: same
      ? null
      : differsBecause(stack, node, edge, part, await gitHubStart(gitDir, stack, node, edge, base)),
    evidence,
  };
}

/** What git shows about where GitHub's diff of a PR starts, for saying why it differs. */
interface GitHubStart {
  /** Where GitHub's diff starts. */
  base: string;
  /**
   * GitHub's base doesn't hold where the PR's own changes start, so GitHub's
   * diff also shows commits the PR sits on.
   */
  repeats: boolean;
  /** The parent's head holds the merge commit of a PR merged into its branch. */
  inParent: boolean;
}

async function gitHubStart(
  gitDir: string,
  stack: Stack,
  node: StackNode,
  edge: StackEdge | null,
  base: string,
): Promise<GitHubStart> {
  const anchor = node.anchor as string;
  const parent = edge ? stack.nodes.find((other) => other.pr.number === edge.parent) : undefined;
  const merge = node.pr.mergeCommitOid;
  return {
    base,
    repeats: (await mergeBase(gitDir, base, anchor)) !== anchor,
    inParent:
      edge?.link === "merged-into-parent" && parent && merge
        ? (await mergeBase(gitDir, merge, parent.pr.headOid)) === merge
        : false,
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
  part: Omit<PrPart, "github" | "provenance" | "summary">,
  { base, repeats, inParent }: GitHubStart,
): string {
  const n = `#${node.pr.number}`;
  const baseRef = node.pr.baseRef;
  const open = node.pr.state === "open";
  const ended = node.pr.state === "merged" ? "merged" : "closed";
  if (part.how === "apart") {
    return `${n} couldn't be put on the stack below it, so Strata shows its changes since it branched, and GitHub diffs it from ${baseRef}.`;
  }
  const parent = edge ? stack.nodes.find((other) => other.pr.number === edge.parent) : undefined;
  const p = parent ? `#${parent.pr.number}` : null;
  const link = edge?.link;
  // Retargeted to a branch that doesn't hold the parent's commits it sits on.
  if (edge?.via === "retarget" && repeats && (link === "intact" || link === "behind")) {
    // The parent landed on that same branch as a new commit, such as a squash.
    if (parent?.pr.state === "merged" && parent.pr.baseRef === baseRef) {
      const since = open ? "hasn't been rebased since" : `wasn't rebased before it ${ended}`;
      return `${p} landed on ${baseRef} as a new commit, and ${n} ${since}, so GitHub's diff of ${n} repeats ${p}'s changes.`;
    }
    return `${n} was retargeted to ${baseRef}, which doesn't have all of ${p}'s commits, so GitHub's diff of ${n} repeats the ones it sits on.`;
  }
  switch (link) {
    case "behind":
      // GitHub diffs it from where it left the parent only while its base holds that.
      if (base !== node.anchor) break;
      return open
        ? `${n} is behind ${p}, so GitHub diffs it from where it left ${p}, and Strata from ${p}'s head now.`
        : `${n} was behind ${p} when it ${ended}, so GitHub diffs it from where it left ${p}, and Strata from ${p}'s head now.`;
    case "stale":
      if (!repeats) break;
      return `${p} was force-pushed after ${n} branched from it, so GitHub's diff of ${n} repeats the old ${p} commits it sits on, and Strata's starts at ${p}'s head now.`;
    case "re-anchored":
      if (node.pr.baseRef === edge?.ref) {
        // It still targets the parent's branch, but sits somewhere else.
        const moved = `${n} ${open ? "no longer sits" : "didn't sit"} on ${p}'s head but ${open ? "still targets" : "targeted"} ${baseRef}`;
        return repeats
          ? `${moved}, so GitHub's diff of ${n} also shows the commits it sits on that ${baseRef} doesn't have.`
          : `${moved}, so GitHub diffs it from where it meets ${baseRef}, and Strata from the stack below it.`;
      }
      return `${n} ${open ? "now sits" : "sat"} on ${baseRef} rather than on ${p}, so GitHub diffs it from ${baseRef}, and Strata from the stack below it.`;
    case "merged-into-parent": {
      if (inParent) {
        return `${n} was merged into ${baseRef}, so its changes are in ${p}'s diff here, and GitHub's diff of ${n} shows them as its own.`;
      }
      // Merged after the parent landed, onto a branch that had moved on since.
      const late = stack.issues.some(
        (issue) => issue.kind === "base-already-merged" && issue.prs[0] === node.pr.number,
      );
      if (late && base !== parent?.pr.headOid) {
        return `${n} was merged into ${baseRef} after ${p} landed, so GitHub diffs it from ${baseRef} as it was then, and Strata from the stack below it.`;
      }
      break;
    }
  }
  if (part.how === "replayed") {
    return `A PR below ${n} was replayed onto newer code, so Strata diffs ${n} from that, and GitHub from ${baseRef}.`;
  }
  return `GitHub diffs ${n} from where it meets ${baseRef}, and Strata from the stack below it.`;
}

function commitEvidence(oid: string, label: string): Evidence {
  return { anchor: { source: { kind: "commit", oid } }, label };
}

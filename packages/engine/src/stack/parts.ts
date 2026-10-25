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
 */
import {
  buildDiff,
  type DiffModel,
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

export interface StackDiffs {
  parts: PrPart[];
  /** From where the stack left the trunk to the last PR placed. Null when no PR could be. */
  whole: { from: string; to: string; diff: string; model: DiffModel } | null;
  /** Replay conflicts. They belong with the stack's own issues. */
  issues: StackIssue[];
  /** The PRs the whole-stack diff covers, bottom first. */
  placed: number[];
}

export async function buildStackDiffs(stack: Stack, gitDir: string): Promise<StackDiffs> {
  const nodes = new Map(stack.nodes.map((node) => [node.pr.number, node]));
  const edges = new Map(stack.edges.map((edge) => [edge.child, edge]));
  const parts: PrPart[] = [];
  const issues: StackIssue[] = [];
  const placed: number[] = [];
  // The stack so far, as Strata's own commit. Null once a PR couldn't be placed.
  let at: string | null = stack.base;
  let end: string | null = null;

  for (const number of stack.selectedPath) {
    const node = nodes.get(number) as StackNode;
    const head = node.pr.headOid;
    const edge = edges.get(number) ?? null;
    if (!node.anchor) {
      parts.push({
        pr: number,
        how: "unknown",
        from: null,
        to: null,
        files: [],
        hunks: [],
        github: null,
      });
      at = null;
      continue;
    }

    let part: Omit<PrPart, "github">;
    if (at === null) {
      part = await apart(gitDir, number, node.anchor, head);
    } else {
      const direct = (await treeOf(gitDir, at)) === (await treeOf(gitDir, node.anchor));
      const result = direct
        ? ({ kind: "clean", tree: await treeOf(gitDir, head) } as const)
        : await replay(gitDir, node.anchor, at, head);
      if (result.kind === "conflict") {
        issues.push(conflictIssue(node, edge, placed, result.paths));
        part = await apart(gitDir, number, node.anchor, head);
        at = null;
      } else {
        const to = await commitTree(gitDir, result.tree, at, `#${number}`);
        part = {
          pr: number,
          how: direct ? "direct" : "replayed",
          from: at,
          to,
          ...(await diffModel(gitDir, at, to)),
        };
        placed.push(number);
        at = to;
        end = to;
      }
    }
    const github =
      node.pr.state === "open" ? await compareWithGitHub(gitDir, stack, node, edge, part) : null;
    parts.push({ ...part, github });
  }

  const whole =
    stack.base && end
      ? { from: stack.base, to: end, ...(await wholeDiff(gitDir, stack.base, end)) }
      : null;
  return { parts, whole, issues, placed };
}

async function apart(
  gitDir: string,
  pr: number,
  anchor: string,
  head: string,
): Promise<Omit<PrPart, "github">> {
  return { pr, how: "apart", from: anchor, to: head, ...(await diffModel(gitDir, anchor, head)) };
}

async function diffModel(gitDir: string, from: string, to: string) {
  const { files, hunks } = buildDiff(await diffText(gitDir, from, to));
  return { files, hunks };
}

async function wholeDiff(gitDir: string, from: string, to: string) {
  const diff = await diffText(gitDir, from, to);
  return { diff, model: buildDiff(diff) };
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
  part: Omit<PrPart, "github">,
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
  part: Omit<PrPart, "github">,
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

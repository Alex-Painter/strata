/**
 * The git operations behind a stack's diffs: diff two commits with fixed
 * settings, merge one PR's changes onto the stack so far, and record the
 * result as a commit. Everything runs in Strata's own bare cache; no index or
 * working tree is involved.
 */
import { git, gitEnv, gitOk } from "./run.js";

/**
 * Fixed diff settings, so neither git's defaults changing under config nor a
 * user's settings can change what the parser sees. See core's diff/parse.ts.
 */
export const DIFF_ARGS = [
  "-c",
  "core.quotePath=true",
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--find-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--unified=3",
];

export function diffText(gitDir: string, from: string, to: string): Promise<string> {
  return gitOk(gitDir, [...DIFF_ARGS, from, to, "--"]);
}

export function treeOf(gitDir: string, commit: string): Promise<string> {
  return gitOk(gitDir, ["rev-parse", "--verify", `${commit}^{tree}`]).then((out) => out.trim());
}

/** A branch's tip in the cache, or null when it isn't there. */
export async function branchTip(gitDir: string, branch: string): Promise<string | null> {
  const { code, stdout } = await git(gitDir, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}^{commit}`,
  ]);
  return code === 0 ? stdout.trim() : null;
}

/** The single best merge base, or null when there is none or several. */
export async function mergeBase(gitDir: string, a: string, b: string): Promise<string | null> {
  const { code, stdout } = await git(gitDir, ["merge-base", "--all", a, b]);
  const bases = stdout.trim().split("\n").filter(Boolean);
  return code === 0 && bases.length === 1 ? (bases[0] as string) : null;
}

/** Commits Strata writes have a fixed author, committer and date, so the same code gives the same ids. */
const AUTHOR = {
  GIT_AUTHOR_NAME: "Strata",
  GIT_AUTHOR_EMAIL: "strata@localhost",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00+0000",
  GIT_COMMITTER_NAME: "Strata",
  GIT_COMMITTER_EMAIL: "strata@localhost",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00+0000",
};

export async function commitTree(
  gitDir: string,
  tree: string,
  parent: string,
  message: string,
): Promise<string> {
  const out = await gitOk(gitDir, ["commit-tree", tree, "-p", parent, "-m", message], {
    ...gitEnv(),
    ...AUTHOR,
  });
  return out.trim();
}

export type ReplayResult = { kind: "clean"; tree: string } | { kind: "conflict"; paths: string[] };

/**
 * Applies the changes from `base` to `theirs` onto `ours`: a three-way merge
 * with `base` as the merge base, written as a tree.
 *
 * `git merge-tree --merge-base` needs git 2.40. To work on 2.38 and later
 * (Apple's git is often 2.39), this gives git a stand-in for `ours` whose only
 * parent is `base`. Since `base` is an ancestor of `theirs`, it's then the one
 * merge base git finds.
 */
export async function replay(
  gitDir: string,
  base: string,
  ours: string,
  theirs: string,
): Promise<ReplayResult> {
  const standIn = await commitTree(gitDir, await treeOf(gitDir, ours), base, "Strata replay");
  const { code, stdout, stderr } = await git(gitDir, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    standIn,
    theirs,
  ]);
  const [tree = "", ...rest] = stdout.split("\n");
  if (code === 0) return { kind: "clean", tree: tree.trim() };
  if (code === 1) {
    const paths = [...new Set(rest.map((line) => line.trim()).filter(Boolean))].sort();
    return { kind: "conflict", paths };
  }
  const [major, minor] = await gitVersion();
  if (major < 2 || (major === 2 && minor < 38)) {
    throw new Error(`Replaying a PR needs git 2.38 or later, and this is git ${major}.${minor}.`);
  }
  throw new Error(`git merge-tree failed (${code}): ${stderr.trim()}`);
}

/** `git version 2.43.0` gives [2, 43]. */
export async function gitVersion(): Promise<[number, number]> {
  const out = await gitOk(process.cwd(), ["version"]);
  const match = /(\d+)\.(\d+)/.exec(out);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

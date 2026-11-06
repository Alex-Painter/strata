/**
 * The git operations behind a stack's diffs: diff two commits with fixed
 * settings, merge one PR's changes onto the stack so far, and record the
 * result as a commit. Everything runs in Strata's own bare cache; no index or
 * working tree is involved.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitEnv, gitOk } from "./run.js";

/**
 * Attributes from a tree that doesn't exist, so the repo's own .gitattributes
 * (a diff driver, `-diff`, a merge driver) can't change diffs or replays.
 * Strata reads the linguist attributes itself. Git before 2.42 ignores the
 * setting, and reads no in-tree attributes in a bare repo anyway.
 */
const NO_ATTRIBUTES = ["-c", "attr.tree=4b825dc642cb6eb9a060e54bf8d69288fbee4904"];

/**
 * Fixed diff settings, so neither git's defaults changing under config nor a
 * user's settings can change what the parser sees. See core's diff/parse.ts.
 */
export const DIFF_ARGS = [
  ...NO_ATTRIBUTES,
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

/** A file's text at a commit, or null when it isn't there. */
export async function readBlob(
  gitDir: string,
  commit: string,
  path: string,
): Promise<string | null> {
  const { code, stdout } = await git(gitDir, ["cat-file", "blob", `${commit}:${path}`]);
  return code === 0 ? stdout : null;
}

/**
 * The commit behind each line of `path`, by line number from 1, over the
 * commits from `from` (exclusive) to `to`. Lines older than `from` get `from`.
 *
 * Forward, the lines are `path` at `to`, each with the commit that wrote it.
 * With `reverse`, they're `path` at `from`, each with the last commit it was
 * still there in: `to` if it survived, or the commit before the one that
 * changed or removed it.
 */
export async function blame(
  gitDir: string,
  from: string,
  to: string,
  path: string,
  options: { reverse?: boolean } = {},
): Promise<string[]> {
  const out = await gitOk(gitDir, [
    ...NO_ATTRIBUTES,
    "blame",
    "--porcelain",
    "--no-textconv",
    ...(options.reverse ? ["--reverse"] : []),
    `${from}..${to}`,
    "--",
    path,
  ]);
  const commits: string[] = [];
  for (const line of out.split("\n")) {
    // Each line of the file is a header (commit, line before, line now),
    // optional details, then the line itself after a tab.
    const header = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)/.exec(line);
    if (header) commits[Number(header[2])] = header[1] as string;
  }
  return commits;
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

/** A branch or commit id as a full commit id, or null when the cache doesn't have it. */
export async function resolveCommit(gitDir: string, ref: string): Promise<string | null> {
  // A leading "-" would be read as an option.
  if (ref.startsWith("-")) return null;
  const { code, stdout } = await git(gitDir, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
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

export type ReplayResult =
  | { kind: "clean"; tree: string }
  /** `tree` holds the merge with conflict markers in `paths`. */
  | { kind: "conflict"; paths: string[]; tree: string };

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
    ...NO_ATTRIBUTES,
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
    return { kind: "conflict", paths, tree: tree.trim() };
  }
  const [major, minor] = await gitVersion();
  if (major < 2 || (major === 2 && minor < 38)) {
    throw new Error(
      `Strata must have git 2.38 or later to replay a PR. This is git ${major}.${minor}.`,
    );
  }
  throw new Error(`git merge-tree failed (${code}): ${stderr.trim()}`);
}

/**
 * `tree` with each of `paths` as it is at `commit`, or gone when `commit` does
 * not have it. Uses a throwaway index file, thus the cache stays bare.
 */
export async function takePaths(
  gitDir: string,
  tree: string,
  commit: string,
  paths: string[],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "strata-index-"));
  const env = { ...gitEnv(), GIT_INDEX_FILE: join(dir, "index") };
  try {
    await gitOk(gitDir, ["read-tree", tree], env);
    const theirs = await gitOk(gitDir, ["ls-tree", "-z", commit, "--", ...paths]);
    const found = new Map<string, string>();
    for (const entry of theirs.split("\0").filter(Boolean)) {
      const [meta = "", path = ""] = entry.split("\t");
      const [mode, , oid] = meta.split(" ");
      found.set(path, `${mode} ${oid}\t${path}`);
    }
    const zero = "0".repeat(40);
    const info = paths.map((path) => found.get(path) ?? `0 ${zero}\t${path}`);
    await gitOk(gitDir, ["update-index", "-z", "--index-info"], env, `${info.join("\0")}\0`);
    return (await gitOk(gitDir, ["write-tree"], env)).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `git version 2.43.0` gives [2, 43]. */
export async function gitVersion(): Promise<[number, number]> {
  const out = await gitOk(process.cwd(), ["version"]);
  const match = /(\d+)\.(\d+)/.exec(out);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

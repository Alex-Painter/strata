/**
 * Parses what a reviewer types into a ChangeInput:
 *
 *   owner/repo#123                     the stack around a PR
 *   https://github.com/owner/repo/pull/123
 *   owner/repo:feature/x               the stack around a branch's PR
 *   owner/repo#12,13,14                an explicit chain, bottom first
 *   owner/repo@main...feature          a commit range on GitHub
 *   main...feature                     a commit range in a local checkout
 */
import type { ChangeInput, RepoRef } from "./change.js";

const REPO = "([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)";
const PR_URL = new RegExp(`^https://github\\.com/${REPO}/pull/(\\d+)(?:[/?#].*)?$`);
const PR_LIST = new RegExp(`^${REPO}#(\\d+(?:\\s*,\\s*\\d+)*)$`);
const GITHUB_RANGE = new RegExp(`^${REPO}@([^\\s.][^\\s]*?)\\.\\.\\.?([^\\s.][^\\s]*)$`);
const LOCAL_RANGE = /^([^\s.][^\s]*?)\.\.\.?([^\s.][^\s]*)$/;
const BRANCH = new RegExp(`^${REPO}:([^\\s:]+)$`);

export class ChangeInputError extends Error {}

export function parseChangeInput(
  raw: string,
  options: { localRepoPath?: string } = {},
): ChangeInput {
  const text = raw.trim();

  const url = PR_URL.exec(text);
  if (url) {
    return { kind: "stack-of", repo: github(url[1], url[2]), seed: { pr: Number(url[3]) } };
  }

  const branch = BRANCH.exec(text);
  if (branch) {
    return {
      kind: "stack-of",
      repo: github(branch[1], branch[2]),
      seed: { branch: branch[3] as string },
    };
  }

  const list = PR_LIST.exec(text);
  if (list) {
    const numbers = (list[3] ?? "").split(",").map((n) => Number(n.trim()));
    const repo = github(list[1], list[2]);
    if (new Set(numbers).size !== numbers.length) {
      throw new ChangeInputError(`"${text}" lists the same PR more than once.`);
    }
    return numbers.length === 1
      ? { kind: "stack-of", repo, seed: { pr: numbers[0] as number } }
      : { kind: "stack", repo, numbers };
  }

  const ghRange = GITHUB_RANGE.exec(text);
  if (ghRange) {
    return {
      kind: "range",
      repo: github(ghRange[1], ghRange[2]),
      base: ghRange[3] as string,
      head: ghRange[4] as string,
    };
  }

  const localRange = LOCAL_RANGE.exec(text);
  if (localRange && options.localRepoPath) {
    return {
      kind: "range",
      repo: { kind: "local", path: options.localRepoPath },
      base: localRange[1] as string,
      head: localRange[2] as string,
    };
  }

  throw new ChangeInputError(
    `Can't read "${text}". Use owner/repo#123, a PR URL, owner/repo:branch, ` +
      "owner/repo#12,13,14, owner/repo@base...head, or base...head inside a local checkout.",
  );
}

export function describeRepo(repo: RepoRef): string {
  return repo.kind === "github" ? `${repo.owner}/${repo.name}` : repo.path;
}

export function describeInput(input: ChangeInput): string {
  const repo = describeRepo(input.repo);
  switch (input.kind) {
    case "stack-of": {
      const at = "pr" in input.seed ? `${repo}#${input.seed.pr}` : `${repo}:${input.seed.branch}`;
      return input.seed.leaf === undefined ? at : `${at} up to #${input.seed.leaf}`;
    }
    case "stack":
      return `${repo}#${input.numbers.join(",")}`;
    case "range":
      return input.repo.kind === "github"
        ? `${repo}@${input.base}...${input.head}`
        : `${input.base}...${input.head}`;
  }
}

const REMOTE = [
  // git@github.com:owner/repo.git
  new RegExp(`^[\\w.-]+@github\\.com:${REPO}$`),
  // https://github.com/owner/repo.git, ssh://git@github.com/owner/repo.git, git://…
  new RegExp(`^(?:https?|ssh|git)://(?:[^@/]+@)?github\\.com(?::\\d+)?/${REPO}/?$`),
];

/** The GitHub repo a git remote URL points at, as owner/name, or null if it isn't one. */
export function parseGitHubRemote(url: string): string | null {
  for (const pattern of REMOTE) {
    const match = pattern.exec(url.trim());
    if (match) return `${match[1]}/${(match[2] as string).replace(/\.git$/, "")}`;
  }
  return null;
}

function github(owner: string | undefined, name: string | undefined): RepoRef {
  return { kind: "github", owner: owner as string, name: name as string };
}

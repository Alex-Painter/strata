/**
 * Reads a local checkout: which GitHub repo it's a clone of and which branch
 * it's on, so `strata analyze` with no input can show the stack around the
 * branch you're on. Like every use of a checkout, this only reads it.
 */
import { parseGitHubRemote } from "@strata/core";
import { git } from "./run.js";

export interface Checkout {
  /** The top of the working tree. */
  root: string;
  /** owner/name, from the first of its remotes that's on GitHub; null when none is. */
  repo: string | null;
  /** Null when HEAD is detached. */
  branch: string | null;
}

export class CheckoutError extends Error {}

export async function readCheckout(dir: string): Promise<Checkout> {
  let top: Awaited<ReturnType<typeof git>>;
  try {
    top = await git(dir, ["rev-parse", "--show-toplevel"]);
  } catch {
    // The folder doesn't exist, or git can't run in it.
    top = { stdout: "", stderr: "", code: 1 };
  }
  if (top.code !== 0 || !top.stdout.trim()) {
    throw new CheckoutError(`${dir} is not a git checkout.`);
  }
  const root = top.stdout.trim();
  const head = await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = head.code === 0 ? head.stdout.trim() : null;
  return { root, repo: await githubRepo(root, branch), branch };
}

/** Tries the branch's own remote, then origin, then the only remote there is. */
async function githubRepo(root: string, branch: string | null): Promise<string | null> {
  const remotes = (await git(root, ["remote"])).stdout.split("\n").filter(Boolean);
  const tracked = branch
    ? (await git(root, ["config", "--get", `branch.${branch}.remote`])).stdout.trim()
    : "";
  const order = [tracked, "origin", ...(remotes.length === 1 ? remotes : [])];
  for (const name of order) {
    if (!remotes.includes(name)) continue;
    const url = await git(root, ["remote", "get-url", name]);
    const repo = url.code === 0 ? parseGitHubRemote(url.stdout) : null;
    if (repo) return repo;
  }
  return null;
}

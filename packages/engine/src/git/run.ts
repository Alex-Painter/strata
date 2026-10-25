/**
 * Runs git with Strata's own settings, never the user's.
 *
 * System and global git config are ignored, so a user's aliases, diff
 * drivers, credential helpers or rename settings can't change what Strata
 * sees, and prompts are off so a missing credential fails instead of hanging.
 * Repo-local config in Strata's own cache still applies.
 */
import { execFile } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
  /** git's exit code. */
  code: number;
}

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly result: GitResult,
  ) {
    super(`git ${args.join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
    this.name = "GitError";
  }
}

/** The environment every git call runs in. */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    // GIT_DIR, GIT_WORK_TREE and friends would point git somewhere else.
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
}

/** Runs git and reports its exit code instead of throwing on failure. */
export function git(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = gitEnv(),
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, env, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error);
          return;
        }
        resolve({ stdout, stderr, code: error ? (error.code as number) : 0 });
      },
    );
  });
}

/** Runs git and returns stdout, throwing a GitError on a non-zero exit. */
export async function gitOk(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await git(cwd, args, env);
  if (result.code !== 0) throw new GitError(args, result);
  return result.stdout;
}

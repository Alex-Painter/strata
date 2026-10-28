/**
 * Strata's own bare copy of a repo, under the data folder. A local checkout,
 * when given, only lends its objects to the first clone (`--reference` with
 * `--dissociate`), so the checkout is never written to and later git gc in
 * it can't break the cache.
 *
 * Fetches authenticate with a one-shot credential helper that reads the
 * token from the environment of that one git process. Every other helper is
 * switched off, so your Keychain and credential config are never consulted.
 */
import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gitEnv, gitOk } from "./run.js";

export interface RepoCacheOptions {
  dataDir: string;
  /** A local checkout of the same repo to borrow objects from. Only read. */
  checkout?: string;
  /** For private repos over HTTPS. */
  token?: string;
  /** Where to clone from. Defaults to GitHub over HTTPS. */
  remoteUrl?: string;
  log?: (message: string) => void;
}

export interface FetchRefs {
  /** PRs whose `refs/pull/<n>/head` to fetch, so heads survive deleted branches. */
  pulls: number[];
}

const TOKEN_VAR = "STRATA_GIT_TOKEN";

/**
 * Config for every git call that talks to the remote: clear the helper list,
 * then add one that answers `get` from the environment and ignores
 * `store` and `erase`.
 */
export const CREDENTIAL_ARGS = [
  "-c",
  "credential.helper=",
  "-c",
  `credential.helper=!f() { if test "$1" = get; then printf 'username=x-access-token\\npassword=%s\\n' "$${TOKEN_VAR}"; fi; }; f`,
];

export function remoteEnv(token: string | undefined): NodeJS.ProcessEnv {
  return { ...gitEnv(), [TOKEN_VAR]: token ?? "" };
}

export class RepoCache {
  private constructor(
    readonly repo: string,
    readonly gitDir: string,
    private readonly options: RepoCacheOptions,
  ) {}

  /** Opens the cache for `owner/name`, cloning it first if it isn't there. */
  static async open(repo: string, options: RepoCacheOptions): Promise<RepoCache> {
    const gitDir = join(options.dataDir, "repos", `${repo}.git`);
    const cache = new RepoCache(repo, gitDir, options);
    if (!(await exists(join(gitDir, "HEAD")))) await cache.clone();
    return cache;
  }

  /** Brings every branch up to date, pruning deleted ones, plus the given PR heads. */
  async fetch(refs: FetchRefs): Promise<void> {
    const refspecs = [
      "+refs/heads/*:refs/heads/*",
      ...[...new Set(refs.pulls)]
        .sort((a, b) => a - b)
        .map((n) => `+refs/pull/${n}/head:refs/pull/${n}/head`),
    ];
    const pulls = new Set(refs.pulls).size;
    this.options.log?.(
      `Strata fetches the branches of ${this.repo}${pulls > 0 ? ` and ${pulls} PR heads` : ""}`,
    );
    await gitOk(
      this.gitDir,
      [
        ...CREDENTIAL_ARGS,
        "fetch",
        "--quiet",
        "--no-tags",
        "--prune",
        "--update-head-ok",
        this.remoteUrl(),
        ...refspecs,
      ],
      remoteEnv(this.options.token),
    );
  }

  private remoteUrl(): string {
    return this.options.remoteUrl ?? `https://github.com/${this.repo}.git`;
  }

  private async clone() {
    const { checkout } = this.options;
    this.options.log?.(
      checkout
        ? `Strata clones ${this.repo} into its cache and uses the objects in ${checkout}`
        : `Strata clones ${this.repo} into its cache (only one time)`,
    );
    await mkdir(dirname(this.gitDir), { recursive: true });
    await gitOk(
      dirname(this.gitDir),
      [
        ...CREDENTIAL_ARGS,
        "clone",
        "--quiet",
        "--bare",
        ...(checkout ? ["--reference", checkout, "--dissociate"] : []),
        this.remoteUrl(),
        this.gitDir,
      ],
      remoteEnv(this.options.token),
    );
    // No automatic gc while Strata reads.
    await gitOk(this.gitDir, ["config", "gc.auto", "0"]);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

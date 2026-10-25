/**
 * A throwaway git repo for stack tests. Each helper does what a developer or
 * GitHub would do to a stack (commit, squash-merge, rebase, force-push) and
 * returns the resulting commit, so tests can say where anchors should land.
 *
 * Every commit gets a fixed author and a ticking clock, and each one adds its
 * own file, so merges and rebases never conflict.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv, gitOk } from "../git/run.js";

const EPOCH = Date.UTC(2026, 9, 1) / 1000;

export class StackRepo {
  private clock = 0;
  private files = 0;

  private constructor(readonly dir: string) {}

  /** A repo with one commit on `main`. */
  static async create(): Promise<StackRepo> {
    const repo = new StackRepo(await mkdtemp(join(tmpdir(), "strata-stack-")));
    await repo.git(["init", "--quiet", "--initial-branch=main"]);
    await repo.addFile("main");
    await repo.git(["commit", "--quiet", "-m", "Start main"]);
    return repo;
  }

  /** Adds a commit on `branch`, first creating it at `from` when given. */
  async commit(branch: string, from?: string): Promise<string> {
    await this.git(
      from ? ["checkout", "--quiet", "-b", branch, from] : ["checkout", "--quiet", branch],
    );
    await this.addFile(branch);
    await this.git(["commit", "--quiet", "-m", `Work on ${branch}`]);
    return this.tip(branch);
  }

  /** Squashes `branch` into one new commit on `into`, as GitHub's squash merge does. */
  async squashMerge(branch: string, into: string): Promise<string> {
    await this.git(["checkout", "--quiet", into]);
    await this.git(["merge", "--quiet", "--squash", branch]);
    await this.git(["commit", "--quiet", "-m", `Squash ${branch}`]);
    return this.tip(into);
  }

  /** Merges `branch` into `into` with a merge commit. */
  async mergeCommit(branch: string, into: string): Promise<string> {
    await this.git(["checkout", "--quiet", into]);
    await this.git(["merge", "--quiet", "--no-ff", "--no-edit", branch]);
    return this.tip(into);
  }

  /** Moves the commits of `branch` after `upstream` onto `onto`. */
  async rebase(branch: string, onto: string, upstream: string): Promise<string> {
    await this.git(["rebase", "--quiet", "--onto", onto, upstream, branch]);
    return this.tip(branch);
  }

  /** Rewrites the tip of `branch`, as a force-push would. */
  async amend(branch: string): Promise<string> {
    await this.git(["checkout", "--quiet", branch]);
    await this.addFile(branch);
    await this.git(["commit", "--quiet", "--amend", "--no-edit"]);
    return this.tip(branch);
  }

  /** Deletes a branch, as GitHub does after a merge. */
  async deleteBranch(branch: string): Promise<void> {
    await this.git(["checkout", "--quiet", "--detach"]);
    await this.git(["branch", "--quiet", "-D", branch]);
  }

  /** Keeps a PR's head reachable after its branch is gone, like `refs/pull/N/head`. */
  async holdPr(number: number, oid: string): Promise<void> {
    await this.git(["update-ref", `refs/pull/${number}/head`, oid]);
  }

  async tip(ref: string): Promise<string> {
    return (await this.git(["rev-parse", `${ref}^{commit}`])).trim();
  }

  async remove(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  private async addFile(branch: string) {
    const n = ++this.files;
    await writeFile(join(this.dir, `${branch.replaceAll("/", "-")}-${n}.txt`), `${n}\n`);
    await this.git(["add", "--all"]);
  }

  private git(args: string[]): Promise<string> {
    const date = `${EPOCH + 60 * ++this.clock} +0000`;
    return gitOk(this.dir, args, {
      ...gitEnv(),
      GIT_AUTHOR_NAME: "Strata Test",
      GIT_AUTHOR_EMAIL: "test@strata.invalid",
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: "Strata Test",
      GIT_COMMITTER_EMAIL: "test@strata.invalid",
      GIT_COMMITTER_DATE: date,
    });
  }
}

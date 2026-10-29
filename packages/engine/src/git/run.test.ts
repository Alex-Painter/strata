import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CREDENTIAL_ARGS } from "./cache.js";
import { GitError, gitOk } from "./run.js";

it("leaves -c config, such as the credential helper, out of a failure's message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "strata-git-"));
  try {
    const failed = await gitOk(dir, [...CREDENTIAL_ARGS, "rev-parse", "HEAD"]).catch((e) => e);
    expect(failed).toBeInstanceOf(GitError);
    expect(failed.message).toMatch(/^git rev-parse HEAD failed \(128\): /);
    expect(failed.message).not.toContain("credential");
    expect(failed.args).toEqual([...CREDENTIAL_ARGS, "rev-parse", "HEAD"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckoutError, readCheckout } from "./checkout.js";
import { gitOk } from "./run.js";

let dir: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "strata-checkout-")));
  await gitOk(dir, ["init", "--quiet", "--initial-branch=main"]);
  await gitOk(dir, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.com",
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "first",
  ]);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readCheckout", () => {
  it("reads the GitHub repo and branch, from a folder inside the checkout", async () => {
    await gitOk(dir, ["remote", "add", "origin", "git@github.com:acme/app.git"]);
    await gitOk(dir, ["switch", "--quiet", "-c", "feature/forecasts"]);
    await mkdir(join(dir, "app", "services"), { recursive: true });
    expect(await readCheckout(join(dir, "app", "services"))).toEqual({
      root: dir,
      repo: "acme/app",
      branch: "feature/forecasts",
    });
  });

  it("prefers the branch's own remote, and skips remotes that aren't on GitHub", async () => {
    await gitOk(dir, ["remote", "add", "origin", "https://gitlab.com/acme/app.git"]);
    await gitOk(dir, ["remote", "add", "fork", "https://github.com/me/app.git"]);
    await gitOk(dir, ["remote", "add", "upstream", "https://github.com/acme/app.git"]);
    expect((await readCheckout(dir)).repo).toBeNull();
    await gitOk(dir, ["config", "branch.main.remote", "upstream"]);
    expect((await readCheckout(dir)).repo).toBe("acme/app");
  });

  it("says when HEAD is detached, or the folder isn't a checkout", async () => {
    await gitOk(dir, ["switch", "--quiet", "--detach"]);
    expect(await readCheckout(dir)).toEqual({ root: dir, repo: null, branch: null });
    const elsewhere = await mkdtemp(join(tmpdir(), "strata-not-a-checkout-"));
    try {
      await expect(readCheckout(elsewhere)).rejects.toThrow(CheckoutError);
      await expect(readCheckout(join(elsewhere, "missing"))).rejects.toThrow(
        /missing is not a git checkout/,
      );
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});

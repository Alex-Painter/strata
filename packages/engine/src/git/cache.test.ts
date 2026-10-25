import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StackRepo } from "../testing/stack-repo.js";
import { CREDENTIAL_ARGS, RepoCache, remoteEnv } from "./cache.js";
import { git, gitOk } from "./run.js";

let remote: StackRepo;
let dataDir: string;
beforeEach(async () => {
  remote = await StackRepo.create();
  dataDir = await mkdtemp(join(tmpdir(), "strata-data-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await remote.remove();
  await rm(dataDir, { recursive: true, force: true });
});

const refs = async (gitDir: string) =>
  (await gitOk(gitDir, ["for-each-ref", "--format=%(refname) %(objectname)"]))
    .trim()
    .split("\n")
    .filter(Boolean);

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("RepoCache", () => {
  it("clones into the data folder and fetches branches and PR heads", async () => {
    const h1 = await remote.commit("b1", "main");
    await remote.holdPr(1, h1);
    const cache = await RepoCache.open("acme/app", { dataDir, remoteUrl: remote.dir });

    expect(cache.gitDir).toBe(join(dataDir, "repos", "acme/app.git"));
    await cache.fetch({ pulls: [1] });
    expect(await refs(cache.gitDir)).toEqual([
      `refs/heads/b1 ${h1}`,
      `refs/heads/main ${await remote.tip("main")}`,
      `refs/pull/1/head ${h1}`,
    ]);
  });

  it("prunes deleted branches but keeps PR heads, as GitHub does", async () => {
    const h1 = await remote.commit("b1", "main");
    await remote.holdPr(1, h1);
    const cache = await RepoCache.open("acme/app", { dataDir, remoteUrl: remote.dir });
    await cache.fetch({ pulls: [1] });

    const s1 = await remote.squashMerge("b1", "main");
    await remote.deleteBranch("b1");
    await cache.fetch({ pulls: [1] });

    expect(await refs(cache.gitDir)).toEqual([`refs/heads/main ${s1}`, `refs/pull/1/head ${h1}`]);
  });

  it("borrows objects from a checkout once, then stands alone", async () => {
    const checkout = join(dataDir, "checkout");
    await gitOk(dataDir, ["clone", "--quiet", remote.dir, checkout]);

    const cache = await RepoCache.open("acme/app", { dataDir, remoteUrl: remote.dir, checkout });

    expect(await exists(join(cache.gitDir, "objects/info/alternates"))).toBe(false);
    await rm(checkout, { recursive: true, force: true });
    const { code } = await git(cache.gitDir, ["fsck", "--connectivity-only"]);
    expect(code).toBe(0);
  });

  it("reopens an existing cache without cloning again", async () => {
    const first = await RepoCache.open("acme/app", { dataDir, remoteUrl: remote.dir });
    await remote.commit("main");
    const again = await RepoCache.open("acme/app", { dataDir, remoteUrl: remote.dir });

    expect(again.gitDir).toBe(first.gitDir);
    // Not cloned again: main only moves on fetch.
    expect(await refs(again.gitDir)).not.toContain(`refs/heads/main ${await remote.tip("main")}`);
  });
});

describe("git isolation", () => {
  it("asks only Strata's credential helper, whatever your git config says", async () => {
    // Your config, in every place git looks: each sets a helper that would leave a mark.
    const home = join(dataDir, "home");
    const marks = join(dataDir, "marks");
    await mkdir(join(home, ".config/git"), { recursive: true });
    await mkdir(marks);
    const helper = (name: string) =>
      `[credential]\n\thelper = "!f() { touch ${marks}/${name}; echo password=theirs; }; f"\n` +
      "[diff]\n\tnoprefix = true\n";
    await writeFile(join(home, ".gitconfig"), helper("global"));
    await writeFile(join(home, ".config/git/config"), helper("xdg"));
    await writeFile(join(dataDir, "system.gitconfig"), helper("system"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
    vi.stubEnv("GIT_CONFIG_SYSTEM", join(dataDir, "system.gitconfig"));
    const cache = await RepoCache.open("acme/app", { dataDir, remoteUrl: remote.dir });

    const answer = await gitOk(
      cache.gitDir,
      [...CREDENTIAL_ARGS, "credential", "fill"],
      remoteEnv("ours"),
      "protocol=https\nhost=github.com\n\n",
    );
    const config = await gitOk(
      cache.gitDir,
      ["config", "--list", "--show-origin"],
      remoteEnv("ours"),
    );

    expect(answer).toContain("username=x-access-token\npassword=ours\n");
    expect(await exists(join(marks, "global"))).toBe(false);
    expect(await exists(join(marks, "xdg"))).toBe(false);
    expect(await exists(join(marks, "system"))).toBe(false);
    expect(config).not.toContain(home);
    expect(config).not.toContain("noprefix");
  });
});

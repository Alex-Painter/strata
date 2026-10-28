import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChangeReport } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkoutAround,
  injectReport,
  OutputError,
  readTemplate,
  refuseCheckouts,
  reportPaths,
} from "./html.js";

const report = { change: { title: "</script><!-- \u2028" } } as unknown as ChangeReport;

describe("injectReport", () => {
  it("inserts the report before </head> so the content can't escape the script tag", () => {
    const html = injectReport("<html><head><title>x</title></head><body></body></html>", report);
    expect(html).toMatch(
      /<script id="strata-report" type="application\/json">.*<\/script><\/head>/,
    );
    const json =
      /<script id="strata-report" type="application\/json">(.*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(json).not.toContain("<");
    expect(json).not.toContain("\u2028");
    expect(JSON.parse(json)).toEqual(report);
  });

  it("refuses a template without </head>", () => {
    expect(() => injectReport("<html></html>", report)).toThrow(/does not have <\/head>/);
  });
});

const github = {
  change: { id: "chg_1a2b", repo: { kind: "github", owner: "acme", name: "app" } },
} as unknown as ChangeReport;

describe("reportPaths", () => {
  it("puts the page and JSON in the data folder by default", () => {
    expect(reportPaths("/data", github)).toEqual({
      page: "/data/reports/acme/app/chg_1a2b.html",
      json: "/data/reports/acme/app/chg_1a2b.json",
    });
  });

  it("takes --out, with the JSON next to it unless --json says otherwise", () => {
    expect(reportPaths("/data", github, { out: "/out/page.html" })).toEqual({
      page: "/out/page.html",
      json: "/out/page.json",
    });
    expect(reportPaths("/data", github, { out: "/out/page", json: "/j/r.json" })).toEqual({
      page: "/out/page",
      json: "/j/r.json",
    });
  });
});

describe("refusing to write inside a checkout", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(tmpdir(), "strata-out-")));
    await mkdir(path.join(dir, "work", ".git"), { recursive: true });
    await mkdir(path.join(dir, "work", "app"));
    // A worktree's .git is a file.
    await mkdir(path.join(dir, "tree"));
    await writeFile(path.join(dir, "tree", ".git"), "gitdir: ../work/.git/worktrees/tree\n");
    await mkdir(path.join(dir, "elsewhere"));
    await symlink(path.join(dir, "work", "app"), path.join(dir, "elsewhere", "link"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds the checkout a path is in, even through folders not made yet or a symlink", async () => {
    const work = path.join(dir, "work");
    expect(await checkoutAround(path.join(work, "page.html"))).toBe(work);
    expect(await checkoutAround(path.join(work, "app", "new", "deeper", "page.html"))).toBe(work);
    expect(await checkoutAround(path.join(work, ".git", "page.html"))).toBe(work);
    expect(await checkoutAround(path.join(dir, "tree", "page.html"))).toBe(path.join(dir, "tree"));
    expect(await checkoutAround(path.join(dir, "elsewhere", "link", "page.html"))).toBe(work);
    expect(await checkoutAround(path.join(dir, "elsewhere", "page.html"))).toBeNull();
    expect(await checkoutAround(path.join(dir, "data", "reports", "page.html"))).toBeNull();
  });

  it("refuses an output path inside a checkout, and allows one outside", async () => {
    const inside = path.join(dir, "work", "strata-report.html");
    await expect(refuseCheckouts([path.join(dir, "data", "page.html"), inside])).rejects.toThrow(
      `Strata does not write to ${inside}. It is in the git checkout ${path.join(dir, "work")}`,
    );
    await expect(refuseCheckouts([path.join(dir, "data", "page.html")])).resolves.toBeUndefined();
  });

  it("refuses the default location when the data folder is in a checkout", async () => {
    const paths = reportPaths(path.join(dir, "work", ".strata"), github);
    await expect(refuseCheckouts([paths.page, paths.json])).rejects.toThrow(OutputError);
  });
});

describe("readTemplate", () => {
  it("says how to build the web app when its static build is missing", async () => {
    await expect(readTemplate("/nowhere/index.html")).rejects.toThrow(
      "Build it with pnpm --filter @strata/web build.",
    );
  });
});

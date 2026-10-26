import { parseDiff } from "@strata/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StackRepo } from "../testing/stack-repo.js";
import { commitTree, diffText, gitVersion, readBlob, replay, treeOf } from "./diff.js";
import { gitOk } from "./run.js";

let repo: StackRepo;
beforeEach(async () => {
  repo = await StackRepo.create();
});
afterEach(async () => {
  await repo.remove();
});

const lines = (...values: string[]) => `${values.join("\n")}\n`;
const show = (commit: string, path: string) => gitOk(repo.dir, ["show", `${commit}:${path}`]);

describe("diffText", () => {
  it("ignores the repo's own diff settings", async () => {
    const kept = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const before = await repo.write("b", { "notes.md": lines(...kept, "j") }, "main");
    const after = await repo.write("b", { "notes.md": null, "docs/notes.md": lines(...kept, "J") });
    for (const [key, value] of [
      ["diff.noprefix", "true"],
      ["diff.renames", "false"],
      ["diff.context", "0"],
      ["color.diff", "always"],
    ] as const) {
      await gitOk(repo.dir, ["config", key, value]);
    }

    const text = await diffText(repo.dir, before, after);
    expect(text).not.toContain("\u001b[");
    const [file] = parseDiff(text);
    expect(file).toMatchObject({ path: "docs/notes.md", oldPath: "notes.md", status: "renamed" });
    // Three lines of context, whatever diff.context says.
    expect(file?.hunks[0]?.lines.filter((line) => line.kind === "context")).toHaveLength(3);
  });
});

const [major, minor] = await gitVersion();

describe("in-tree attributes", () => {
  // attr.tree arrived in git 2.42; Strata's cache is bare, so older git never
  // reads in-tree attributes there anyway.
  it.skipIf(major < 2 || (major === 2 && minor < 42))(
    "don't change diffs, even in a checkout",
    async () => {
      const before = await repo.write(
        "b",
        { ".gitattributes": "*.txt -diff\n", "a.txt": "one\n" },
        "main",
      );
      const after = await repo.write("b", { "a.txt": "two\n" });
      const [file] = parseDiff(await diffText(repo.dir, before, after));
      expect(file?.binary).toBe(false);
      expect(file?.hunks).toHaveLength(1);
    },
  );
});

describe("readBlob", () => {
  it("reads a file at a commit, or null", async () => {
    const head = await repo.write("b", { "docs/a.md": "hello\n" }, "main");
    expect(await readBlob(repo.dir, head, "docs/a.md")).toBe("hello\n");
    expect(await readBlob(repo.dir, head, "missing.md")).toBeNull();
  });
});

describe("replay", () => {
  it("puts a PR's changes onto a newer parent, as a restack would", async () => {
    const base = await repo.write("parent", { "a.txt": lines("one", "two", "three") }, "main");
    const child = await repo.write("child", { "b.txt": lines("child") }, "parent");
    const parent = await repo.write("parent", { "a.txt": lines("one", "TWO", "three") });

    const result = await replay(repo.dir, base, parent, child);
    expect(result.kind).toBe("clean");
    const commit = await commitTree(repo.dir, (result as { tree: string }).tree, parent, "#2");
    expect(await show(commit, "a.txt")).toBe(lines("one", "TWO", "three"));
    expect(await show(commit, "b.txt")).toBe(lines("child"));
  });

  it("names the files that conflict", async () => {
    const base = await repo.write("parent", { "a.txt": lines("one"), "c.txt": lines("c") }, "main");
    const child = await repo.write(
      "child",
      { "a.txt": lines("child's one"), "c.txt": lines("child's c") },
      "parent",
    );
    const parent = await repo.write("parent", { "a.txt": lines("parent's one") });

    expect(await replay(repo.dir, base, parent, child)).toEqual({
      kind: "conflict",
      paths: ["a.txt"],
    });
  });

  it("leaves the repo's branches and working tree alone", async () => {
    const base = await repo.write("parent", { "a.txt": lines("one") }, "main");
    const child = await repo.write("child", { "b.txt": lines("b") }, "parent");
    const parent = await repo.write("parent", { "a.txt": lines("two") });
    const refs = await gitOk(repo.dir, ["for-each-ref"]);
    const status = await gitOk(repo.dir, ["status", "--porcelain"]);

    await replay(repo.dir, base, parent, child);
    expect(await gitOk(repo.dir, ["for-each-ref"])).toBe(refs);
    expect(await gitOk(repo.dir, ["status", "--porcelain"])).toBe(status);
  });
});

describe("commitTree", () => {
  it("gives the same commit for the same tree, parent and message", async () => {
    const head = await repo.write("b", { "a.txt": lines("a") }, "main");
    const tree = await treeOf(repo.dir, head);
    const main = await repo.tip("main");
    const first = await commitTree(repo.dir, tree, main, "#1");
    expect(await commitTree(repo.dir, tree, main, "#1")).toBe(first);
    expect(await commitTree(repo.dir, tree, main, "#2")).not.toBe(first);
  });
});

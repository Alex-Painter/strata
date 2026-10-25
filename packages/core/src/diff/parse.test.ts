import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDiff } from "./parse.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@ export function main() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a };
`;

describe("parseDiff", () => {
  it("parses a modified file with line numbers on both sides", () => {
    const [file] = parseDiff(MODIFIED);
    expect(file).toMatchObject({ path: "src/app.ts", status: "modified", binary: false });
    expect(file?.oldPath).toBeUndefined();
    const hunk = file?.hunks[0];
    expect(hunk).toMatchObject({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      section: "export function main() {",
    });
    expect(hunk?.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ["context", 1, 1],
      ["del", 2, undefined],
      ["add", undefined, 2],
      ["add", undefined, 3],
      ["context", 3, 4],
    ]);
  });

  it("parses added, deleted, renamed and binary files", () => {
    const diff = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
\\ No newline at end of file
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/a/x.ts b/b/y.ts
similarity index 90%
rename from a/x.ts
rename to b/y.ts
index 5555555..6666666 100644
--- a/a/x.ts
+++ b/b/y.ts
@@ -1 +1 @@
-x
+y
diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ
`;
    const files = parseDiff(diff);
    expect(files.map((f) => [f.path, f.status, f.oldPath, f.binary])).toEqual([
      ["new.txt", "added", undefined, false],
      ["old.txt", "deleted", undefined, false],
      ["b/y.ts", "renamed", "a/x.ts", false],
      ["logo.png", "modified", undefined, true],
    ]);
    expect(files[0]?.hunks[0]?.lines[0]).toMatchObject({
      kind: "add",
      content: "hello",
      noNewlineAtEof: true,
    });
    expect(files[2]?.similarity).toBe(90);
  });

  it("handles paths with spaces and content lines that look like headers", () => {
    const diff = `diff --git a/my dir/file one.md b/my dir/file one.md
index 1111111..2222222 100644
--- a/my dir/file one.md
+++ b/my dir/file one.md
@@ -1,2 +1,2 @@
--- a/not-a-header
+++ b/not-a-header
 diff --git a/also b/not
`;
    const [file] = parseDiff(diff);
    expect(file?.path).toBe("my dir/file one.md");
    expect(file?.hunks[0]?.lines.map((l) => [l.kind, l.content])).toEqual([
      ["del", "-- a/not-a-header"],
      ["add", "++ b/not-a-header"],
      ["context", "diff --git a/also b/not"],
    ]);
  });

  it("decodes git's quoted paths", () => {
    const diff = `diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"
new file mode 100644
--- /dev/null
+++ "b/caf\\303\\251.txt"
@@ -0,0 +1 @@
+x
`;
    expect(parseDiff(diff)[0]?.path).toBe("café.txt");
  });

  it("reads every case real git writes, as recorded in the golden files", () => {
    // cases.diff is `git diff` (engine flags) over a repo with: edits in two hunks,
    // added and deleted files, renames with and without edits, an empty file
    // renamed, binaries added and changed, a mode change alone and with an edit,
    // a symlink, no newline at end of file on either side, a path with spaces
    // whose lines look like diff headers, and a quoted non-ASCII path.
    expect(parseDiff(fixture("cases.diff"))).toEqual(JSON.parse(fixture("cases.json")));
  });

  it("records file modes, so a mode change with no hunks still shows", () => {
    const byPath = new Map(parseDiff(fixture("cases.diff")).map((f) => [f.path, f]));
    expect(byPath.get("run.sh")).toMatchObject({ oldMode: "100644", newMode: "100755", hunks: [] });
    expect(byPath.get("link-to-edit")?.newMode).toBe("120000");
    expect(byPath.get("gone.txt")?.oldMode).toBe("100644");
  });

  it("returns nothing for an empty diff", () => {
    expect(parseDiff("")).toEqual([]);
  });
});

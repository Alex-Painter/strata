import { describe, expect, it } from "vitest";
import { createClassifier } from "../layers/classify.js";
import { buildDiff, UNCLASSIFIED } from "./build.js";

const DIFF = `diff --git a/src/models/user.py b/src/models/user.py
index 1111111..2222222 100644
--- a/src/models/user.py
+++ b/src/models/user.py
@@ -1,2 +1,3 @@ class User(Document):
     email: str
+    is_admin: bool = False
     name: str
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 3333333..4444444 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1 @@
-a: 1
+a: 2
diff --git a/src/api/users.py b/src/api/users.py
index 5555555..6666666 100644
--- a/src/api/users.py
+++ b/src/api/users.py
@@ -10,1 +10,2 @@ def get_user():
     return user
+    # admins see everything
diff --git a/bin/run b/bin/run
old mode 100644
new mode 100755
`;

describe("buildDiff", () => {
  const model = buildDiff(DIFF);

  it("lists files by path and counts their lines", () => {
    expect(model.files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["bin/run", "modified", 0, 0],
      ["pnpm-lock.yaml", "modified", 1, 1],
      ["src/api/users.py", "modified", 1, 0],
      ["src/models/user.py", "modified", 1, 0],
    ]);
    expect(model.hunks.map((h) => h.path)).toEqual([
      "pnpm-lock.yaml",
      "src/api/users.py",
      "src/models/user.py",
    ]);
    for (const file of model.files) {
      expect(file.hunkIds).toEqual(
        model.hunks.filter((h) => h.path === file.path).map((h) => h.id),
      );
    }
  });

  it("keeps file modes", () => {
    expect(model.files[0]).toMatchObject({ oldMode: "100644", newMode: "100755", hunkIds: [] });
    expect(model.files[1]).not.toHaveProperty("oldMode");
  });

  it("leaves everything unclassified until a classifier is given", () => {
    expect(model.layers).toEqual([]);
    expect(model.files.every((f) => f.layer === UNCLASSIFIED)).toBe(true);
    expect(model.hunks.every((h) => h.layer === UNCLASSIFIED && h.mechanical === null)).toBe(true);
  });

  it("groups files by layer, in layer order, when classified", () => {
    const classified = buildDiff(DIFF, { classifier: createClassifier() });
    expect(classified.layers.map((g) => [g.layer, g.files.map((f) => f.path)])).toEqual([
      ["data-model", ["src/models/user.py"]],
      ["api", ["src/api/users.py"]],
      ["config", ["pnpm-lock.yaml"]],
      ["other", ["bin/run"]],
    ]);
    // The lockfile is mechanical, file and hunk alike.
    expect(classified.layers[2]).toMatchObject({ meaningfulHunks: 0, mechanicalHunks: 1 });
    expect(classified.files[1]?.mechanical).toEqual({
      kind: "lockfile",
      reason: "Dependency lockfile",
    });
    expect(classified.hunks[0]?.mechanical?.kind).toBe("lockfile");
    expect(classified.layers[0]).toMatchObject({ meaningfulHunks: 1, mechanicalHunks: 0 });
  });

  it("doesn't depend on the order of files in the diff", () => {
    const blocks = DIFF.split(/(?=^diff --git )/m);
    expect(buildDiff([...blocks].reverse().join(""))).toEqual(model);
  });

  it("gives identical hunks in one file distinct, stable ids", () => {
    const twice = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,0 +1,1 @@
+x
@@ -9,0 +10,1 @@
+x
`;
    const ids = buildDiff(twice).hunks.map((h) => h.id);
    expect(new Set(ids).size).toBe(2);
    expect(buildDiff(twice).hunks.map((h) => h.id)).toEqual(ids);
  });

  it("gives a hunk the same id wherever it sits in the file", () => {
    const at = (line: number) => `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -${line},1 +${line},2 @@
 keep
+added
`;
    expect(buildDiff(at(3)).hunks[0]?.id).toBe(buildDiff(at(30)).hunks[0]?.id);
  });
});

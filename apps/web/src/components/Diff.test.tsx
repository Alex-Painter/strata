import { buildDiff, createClassifier } from "@strata/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileList, fileFacts } from "./Diff";

const DIFF = `diff --git a/docs/old.md b/docs/new.md
similarity index 90%
rename from docs/old.md
rename to docs/new.md
index 1111111..2222222 100644
--- a/docs/old.md
+++ b/docs/new.md
@@ -1,3 +1,3 @@ # Title
 one
-two
+TWO
 three
diff --git a/app/jobs/warm.py b/app/jobs/warm.py
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/app/jobs/warm.py
@@ -0,0 +1,2 @@
+def warm():
+    pass
\\ No newline at end of file
diff --git a/icon.png b/icon.png
new file mode 100644
index 0000000..4444444
Binary files /dev/null and b/icon.png differ
diff --git a/bin/run b/bin/run
old mode 100644
new mode 100755
diff --git a/latest b/latest
new file mode 120000
index 0000000..5555555
--- /dev/null
+++ b/latest
@@ -0,0 +1 @@
+releases/v2
\\ No newline at end of file
`;

function render(diff: string, options: { fold?: boolean; selected?: string } = {}) {
  const { files, hunks } = buildDiff(diff, { classifier: createClassifier() });
  const byId = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  document.body.innerHTML = renderToStaticMarkup(
    <FileList
      files={files}
      hunksOf={(file) => file.hunkIds.map((id) => byId.get(id)).filter((h) => h !== undefined)}
      chips={null}
      fold={options.fold ?? true}
      selected={options.selected ?? null}
      onFile={() => {}}
      onHunk={() => {}}
    />,
  );
  return document.body;
}

const lines = (element: Element | null | undefined) =>
  [...(element?.querySelectorAll(".ln") ?? [])].map((row) => [
    row.getAttribute("data-line"),
    ...[...row.children].map((cell) => cell.textContent),
  ]);

describe("FileList", () => {
  it("shows each file with its hunks, and says why it's in its layer", () => {
    const page = render(DIFF);
    expect(
      [...page.querySelectorAll("[data-file]")].map((f) => f.getAttribute("data-file")),
    ).toEqual(["app/jobs/warm.py", "bin/run", "docs/new.md", "icon.png", "latest"]);
    expect(page.querySelector('[data-file="docs/new.md"] p')?.textContent).toContain(
      "Docs: Documentation: matches **/*.{md,mdx,rst,adoc,txt}",
    );
    expect(page.querySelector('[data-file="app/jobs/warm.py"] p')?.textContent).toBe(
      "Added · Logic: No rule matched, so it's taken as application code, a guess",
    );
    expect(page.querySelector('[data-file="bin/run"] p')?.textContent).toContain(
      "Mode 100644 → 100755",
    );
  });

  it("tags each file an inspect rule matched, with where, in any layer but Tests", () => {
    const page = render(
      [
        adding("app/auth/session.py", "TTL = 60"),
        adding("app/service.py", "pass"),
        adding("tests/test_session.py", "def test(): ..."),
      ].join(""),
    );
    const flagged = [...page.querySelectorAll("[data-inspect]")].map((file) => [
      file.getAttribute("data-file"),
      file.getAttribute("data-inspect"),
    ]);
    expect(flagged).toEqual([["app/auth/session.py", "access"]]);
    const file = page.querySelector('[data-file="app/auth/session.py"]');
    expect(file?.querySelector("button[data-nav]")?.textContent).toContain(
      "Access and permissions",
    );
    expect(file?.querySelector("p")?.textContent).toBe(
      "Added · Logic: No rule matched, so it's taken as application code, a guess · " +
        'Inspect: Access and permissions: a word starting "session" in session.py',
    );
  });

  it("says when Claude chose the layer", () => {
    const { files, hunks } = buildDiff(adding("app/jobs/warm.py", "pass"), {
      classifier: createClassifier({
        judged: new Map([
          [
            "app/jobs/warm.py",
            {
              layer: "logic",
              by: "llm",
              reason: "A job that warms the cache",
              confidence: "medium",
            },
          ],
        ]),
      }),
    });
    document.body.innerHTML = renderToStaticMarkup(
      <FileList
        files={files}
        hunksOf={() => hunks}
        chips={null}
        fold
        selected={null}
        onFile={() => {}}
        onHunk={() => {}}
      />,
    );
    expect(document.querySelector('[data-file="app/jobs/warm.py"] p')?.textContent).toBe(
      "Added · Logic: A job that warms the cache, Claude's call",
    );
  });

  const LOCKED = [
    adding("app/service.py", "pass"),
    `diff --git a/uv.lock b/uv.lock
--- a/uv.lock
+++ b/uv.lock
@@ -1,2 +1,2 @@
-version = "1"
-hash = "a"
+version = "2"
+hash = "b"
`,
  ].join("");

  it("folds mechanical files with their reason, and leaves them out of the counts", () => {
    const page = render(LOCKED);
    const lock = page.querySelector('[data-file="uv.lock"]');
    expect(lock?.getAttribute("data-mechanical")).toBe("lockfile");
    expect(lock?.querySelectorAll(".ln")).toHaveLength(0);
    expect(lock?.textContent).toContain("Dependency lockfile");
    expect(lock?.textContent).toContain("Folded: dependency lockfile. Show 1 hunk");
    const count = page.querySelector('[data-file="app/service.py"] .add-n')?.parentElement;
    expect(count?.textContent).toBe("+1 −0");
  });

  it("shows mechanical files when folding is off", () => {
    const page = render(LOCKED, { fold: false });
    expect(page.querySelectorAll('[data-file="uv.lock"] .ln')).toHaveLength(4);
  });

  it("folds whitespace-only hunks in a meaningful file", () => {
    const page = render(`diff --git a/app/a.py b/app/a.py
--- a/app/a.py
+++ b/app/a.py
@@ -1,2 +1,2 @@
-def f(a,b):
-  return a+b
+def f(a, b):
+    return a + b
@@ -10 +10 @@
-x = 1
+x = 2
`);
    const [space, real] = [...page.querySelectorAll('[data-file="app/a.py"] [data-hunk]')];
    expect(space?.getAttribute("data-mechanical")).toBe("whitespace");
    expect(space?.querySelectorAll(".ln")).toHaveLength(0);
    expect(space?.textContent).toContain("Whitespace-only change, 4 lines. Show");
    expect(real?.querySelectorAll(".ln")).toHaveLength(2);
    const count = page.querySelector('[data-file="app/a.py"] .add-n')?.parentElement;
    expect(count?.textContent).toBe("+1 −1");
    expect(count?.getAttribute("title")).toBe("All lines: +3 −3");
  });

  it("renders each line with its number, sign and kind", () => {
    const page = render(DIFF);
    const doc = page.querySelector('[data-file="docs/new.md"]');
    expect(lines(doc)).toEqual([
      ["context", "1", " ", "one"],
      ["del", "2", "-", "two"],
      ["add", "2", "+", "TWO"],
      ["context", "3", " ", "three"],
    ]);
    expect(doc?.querySelector(".hunk-h")?.textContent).toBe("@@ -1,3 +1,3# Title");
    expect(page.querySelector('[data-file="app/jobs/warm.py"]')?.textContent).toContain(
      "No newline at end of file",
    );
  });

  it("starts big files closed, with no lines rendered", () => {
    const big = Array.from({ length: 500 }, (_, i) => `+line ${i}`).join("\n");
    const page = render(`diff --git a/big.txt b/big.txt
new file mode 100644
--- /dev/null
+++ b/big.txt
@@ -0,0 +1,500 @@
${big}
`);
    const file = page.querySelector('[data-file="big.txt"]');
    expect(file?.querySelectorAll(".ln")).toHaveLength(0);
    expect(file?.textContent).toContain("Show 1 hunk, +500 −0");
  });

  it("marks the selected file and hunk, and makes each one a stop for J and K", () => {
    const { hunks } = buildDiff(DIFF);
    const doc = hunks.find((hunk) => hunk.path === "docs/new.md");
    const page = render(DIFF, { selected: doc?.id ?? "" });
    const stops = [...page.querySelectorAll("[data-nav]")].map((el) => el.getAttribute("data-nav"));
    expect(stops.slice(2, 5)).toEqual(["file:bin/run", "file:docs/new.md", `hunk:${doc?.id}`]);
    expect(page.querySelector(`[data-hunk="${doc?.id}"]`)?.getAttribute("data-selected")).toBe(
      "true",
    );
    expect(page.querySelector('[aria-current="true"]')?.getAttribute("data-nav")).toBe(
      `hunk:${doc?.id}`,
    );
  });
});

describe("fileFacts", () => {
  it("names renames, modes, symlinks and binaries", () => {
    const { files } = buildDiff(DIFF);
    const facts = Object.fromEntries(files.map((file) => [file.path, fileFacts(file)]));
    expect(facts).toEqual({
      "app/jobs/warm.py": ["Added"],
      "bin/run": ["Mode 100644 → 100755"],
      "docs/new.md": ["Renamed from docs/old.md, 90% the same"],
      "icon.png": ["Added", "Binary file, not shown"],
      latest: ["Added", "Symlink"],
    });
  });
});

function adding(path: string, line: string): string {
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${line}\n`;
}

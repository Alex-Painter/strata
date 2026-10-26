import { buildDiff, createClassifier } from "@strata/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Files, fileFacts, layerAnchor } from "./Diff";

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

function render(diff: string) {
  const { files, hunks } = buildDiff(diff, { classifier: createClassifier() });
  document.body.innerHTML = renderToStaticMarkup(<Files files={files} hunks={hunks} />);
  return document.body;
}

describe("Files", () => {
  it("lists files by layer in review order, then by directory, and links each to its diff", () => {
    const page = render(DIFF);
    const list = page.querySelector('nav[aria-label="File list"]');
    const layers = [...(list?.querySelectorAll("[data-layer]") ?? [])].map((layer) => [
      layer.getAttribute("data-layer"),
      ...[...layer.querySelectorAll(":scope > div > div:first-child")].map(
        (dir) => dir.textContent,
      ),
    ]);
    expect(layers).toEqual([
      ["logic", "app/jobs"],
      ["docs", "docs"],
      ["other", "/", "bin"],
    ]);
    const links = [...(list?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "#file:app/jobs/warm.py",
      "#file:docs/new.md",
      "#file:icon.png",
      "#file:latest",
      "#file:bin/run",
    ]);
    for (const href of links) {
      expect(page.querySelector(`[id="${href?.slice(1)}"]`)).not.toBeNull();
    }
    expect(page.querySelector("header")?.textContent).toContain("5 files · +4 −1");
  });

  it("gives each layer a section, and flags the layers to inspect", () => {
    const page = render(
      [
        adding("migrations/0001_init.sql", "create table t ();"),
        adding("app/service.py", "pass"),
      ].join(""),
    );
    const sections = [...page.querySelectorAll('section[id^="layer:"]')];
    expect(sections.map((section) => section.id)).toEqual([
      layerAnchor("data-model"),
      layerAnchor("logic"),
    ]);
    expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual([
      "Data model",
      "Logic",
    ]);
    expect(sections[0]?.querySelector("h3")?.textContent).toContain("Inspect");
    expect(sections[1]?.querySelector("h3")?.textContent).not.toContain("Inspect");
  });

  it("says why each file is in its layer, and when that's a guess", () => {
    const page = render(DIFF);
    expect(page.querySelector('[data-file="docs/new.md"] p')?.textContent).toContain(
      "Docs: Documentation: matches **/*.{md,mdx,rst,adoc,txt}",
    );
    expect(page.querySelector('[data-file="app/jobs/warm.py"] p')?.textContent).toBe(
      "Added · Logic: No rule matched, so it's taken as application code, a guess",
    );
  });

  it("collapses mechanical files with their reason, and leaves them out of the counts", () => {
    const page = render(
      [
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
      ].join(""),
    );
    const lock = page.querySelector('[data-file="uv.lock"]');
    expect(lock?.getAttribute("data-mechanical")).toBe("lockfile");
    expect(lock?.hasAttribute("open")).toBe(false);
    expect(lock?.querySelector("summary")?.textContent).toContain("Dependency lockfile");
    const header = page.querySelector("header span");
    expect(header?.textContent).toBe("2 files · +1 −0");
    expect(header?.getAttribute("title")).toBe("All lines: +3 −2");
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
    const [space, real] = [...page.querySelectorAll('[data-file="app/a.py"] tbody')];
    expect(space?.getAttribute("data-mechanical")).toBe("whitespace");
    expect(space?.querySelectorAll("tr[data-line]")).toHaveLength(0);
    expect(space?.textContent).toContain("Whitespace-only change, 4 lines. Show");
    expect(real?.querySelectorAll("tr[data-line]")).toHaveLength(2);
    const count = page.querySelector('[data-file="app/a.py"] summary > span:last-child');
    expect(count?.textContent).toBe("+1 −1");
    expect(count?.getAttribute("title")).toBe("All lines: +3 −3");
  });

  it("renders each line with its numbers and kind", () => {
    const page = render(DIFF);
    const doc = page.querySelector('[data-file="docs/new.md"]');
    const rows = [...(doc?.querySelectorAll("tr[data-line]") ?? [])].map((row) => [
      row.getAttribute("data-line"),
      ...[...row.querySelectorAll("td")].map((cell) => cell.textContent),
    ]);
    expect(rows).toEqual([
      ["context", "1", "1", " one"],
      ["del", "2", "", "-two"],
      ["add", "", "2", "+TWO"],
      ["context", "3", "3", " three"],
    ]);
    expect(doc?.querySelector("tbody tr")?.textContent).toBe("@@ -1,3 +1,3 @@ # Title");
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
    expect(file?.hasAttribute("open")).toBe(false);
    expect(file?.querySelectorAll("tr")).toHaveLength(0);
  });

  it("says when there are no changes", () => {
    expect(render("").textContent).toContain("No changes.");
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

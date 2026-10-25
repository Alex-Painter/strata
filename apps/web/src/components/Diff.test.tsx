import { buildDiff } from "@strata/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Files, fileFacts } from "./Diff";

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
  const { files, hunks } = buildDiff(diff);
  document.body.innerHTML = renderToStaticMarkup(<Files files={files} hunks={hunks} />);
  return document.body;
}

describe("Files", () => {
  it("lists files by directory, and links each to its diff", () => {
    const page = render(DIFF);
    const list = page.querySelector('nav[aria-label="File list"]');
    const dirs = [...(list?.querySelectorAll(":scope > div > div:first-child") ?? [])];
    expect(dirs.map((dir) => dir.textContent)).toEqual(["/", "app/jobs", "bin", "docs"]);
    const links = [...(list?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "#file:icon.png",
      "#file:latest",
      "#file:app/jobs/warm.py",
      "#file:bin/run",
      "#file:docs/new.md",
    ]);
    for (const href of links) {
      expect(page.querySelector(`[id="${href?.slice(1)}"]`)).not.toBeNull();
    }
    expect(page.querySelector("header")?.textContent).toContain("5 files · +4 −1");
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

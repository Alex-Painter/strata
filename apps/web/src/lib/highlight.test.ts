import type { DiffLine } from "@strata/core/model";
import { describe, expect, it } from "vitest";
import { highlightLines, languageOf } from "./highlight";

const line = (kind: DiffLine["kind"], content: string): DiffLine => ({
  kind,
  content,
  oldLine: kind === "add" ? null : 1,
  newLine: kind === "del" ? null : 1,
});

describe("languageOf", () => {
  it("knows the repo's languages, its config formats and its docs", () => {
    expect(
      [
        "maverick/outbound/schemas.py",
        "frontend/src/components/outbound/AccountsPage.tsx",
        "frontend/src/api/mutations/outbound.ts",
        "vite.config.mjs",
        "frontend/raw-styling-baseline.json",
        ".github/workflows/ci.yml",
        "pyproject.toml",
        "migrations/0042_forecast_cache.sql",
        "README.md",
        "apps/web/src/styles.css",
        "scripts/deploy.sh",
        "Dockerfile",
        "docker/Dockerfile.worker",
        "Makefile",
        ".env.example",
        "index.html",
      ].map(languageOf),
    ).toEqual([
      "python",
      "typescript",
      "typescript",
      "javascript",
      "json",
      "yaml",
      "ini",
      "sql",
      "markdown",
      "css",
      "bash",
      "dockerfile",
      "dockerfile",
      "makefile",
      "properties",
      "xml",
    ]);
  });

  it("gives plain text for a file it does not know", () => {
    expect(languageOf("uv.lock")).toBeNull();
    expect(languageOf("LICENSE")).toBeNull();
  });
});

describe("highlightLines", () => {
  it("keeps every line's text, and marks keywords and strings", () => {
    const lines = [
      line("context", "def warm(account):"),
      line("del", '    return "old"'),
      line("add", '    return "new"'),
    ];
    const tokens = highlightLines("app/cache.py", lines);
    expect(tokens?.map((each) => each.map((token) => token.text).join(""))).toEqual(
      lines.map((each) => each.content),
    );
    expect(tokens?.[0]?.find((token) => token.text === "def")?.className).toBe("hljs-keyword");
    expect(tokens?.[1]?.find((token) => token.text === '"old"')?.className).toBe("hljs-string");
    expect(tokens?.[2]?.find((token) => token.text === '"new"')?.className).toBe("hljs-string");
  });

  it("keeps a string over several lines in one colour, on each side", () => {
    const lines = [
      line("context", 'NOTE = """'),
      line("add", "added text"),
      line("context", '"""'),
    ];
    const tokens = highlightLines("app/notes.py", lines);
    expect(tokens?.[1]).toEqual([{ text: "added text", className: "hljs-string" }]);
  });

  it("gives null for plain text", () => {
    expect(highlightLines("uv.lock", [line("add", "[[package]]")])).toBeNull();
  });
});

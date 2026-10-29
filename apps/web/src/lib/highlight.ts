import type { DiffLine } from "@strata/core/model";
import type { ElementContent, RootContent } from "hast";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import php from "highlight.js/lib/languages/php";
import properties from "highlight.js/lib/languages/properties";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

/**
 * Syntax highlighting for diff lines. The languages are the ones in the repos
 * Strata reviews first (Python, TypeScript, SQL, the config formats, docs),
 * then other common ones. A file in another language shows as plain text.
 */
const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  makefile,
  markdown,
  nginx,
  php,
  properties,
  protobuf,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
});

const BY_EXTENSION: Record<string, string> = {
  py: "python",
  pyi: "python",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  json5: "json",
  ipynb: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  env: "properties",
  properties: "properties",
  sql: "sql",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  swift: "swift",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  diff: "diff",
  patch: "diff",
};

const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  "nginx.conf": "nginx",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".gitignore": "bash",
  ".dockerignore": "bash",
};

/** The highlighter's language for a path, or null for plain text. */
export function languageOf(path: string): string | null {
  const name = (path.split("/").at(-1) ?? path).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith("dockerfile") || name.endsWith(".dockerfile")) return "dockerfile";
  if (name.startsWith(".env")) return "properties";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (BY_EXTENSION[name.slice(dot + 1)] ?? null) : null;
}

/** A run of text and the highlighter's classes for it ("" for none). */
export interface Token {
  text: string;
  className: string;
}

// Past this, a hunk shows as plain text: highlighting it would cost more than it helps.
const MAX_CHARS = 200_000;

/**
 * Tokens for each line of a hunk, by its index in the hunk, or null when the
 * path has no language. The new side (context and added lines) and the old
 * side (context and deleted lines) are highlighted as two runs of code, so a
 * string or comment over several lines keeps its colour.
 */
export function highlightLines(path: string, lines: DiffLine[]): Token[][] | null {
  const language = languageOf(path);
  if (!language) return null;
  if (lines.reduce((n, line) => n + line.content.length + 1, 0) > MAX_CHARS) return null;
  const out: Token[][] = lines.map(() => []);
  for (const side of ["new", "old"] as const) {
    const at = lines.flatMap((line, i) =>
      side === "new" ? (line.kind === "del" ? [] : [i]) : line.kind === "add" ? [] : [i],
    );
    if (at.length === 0) continue;
    const code = at.map((i) => lines[i]?.content ?? "").join("\n");
    const tokens = byLine(lowlight.highlight(language, code).children);
    at.forEach((i, n) => {
      // Context lines take their tokens from the new side.
      if (side === "old" && lines[i]?.kind === "context") return;
      out[i] = tokens[n] ?? [];
    });
  }
  return out;
}

/** Flattens the highlighter's tree into tokens, cut at each line end. */
function byLine(nodes: Array<RootContent | ElementContent>): Token[][] {
  const lines: Token[][] = [[]];
  const walk = (list: Array<RootContent | ElementContent>, classes: string[]) => {
    for (const node of list) {
      if (node.type === "text") {
        node.value.split("\n").forEach((part, i) => {
          if (i > 0) lines.push([]);
          if (part) lines[lines.length - 1]?.push({ text: part, className: classes.join(" ") });
        });
      } else if (node.type === "element") {
        const own = node.properties?.className;
        walk(node.children, Array.isArray(own) ? [...classes, ...own.map(String)] : classes);
      }
    }
  };
  walk(nodes, []);
  return lines;
}

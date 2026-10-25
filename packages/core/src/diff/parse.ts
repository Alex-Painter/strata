/**
 * Parses `git diff` output (unified format, with rename detection) into files
 * and hunks. Deterministic and dependency-free so the same text always yields
 * the same Change.
 *
 * Expected invocation (see packages/engine/src/git/diff.ts):
 *   git diff --no-color --no-ext-diff --no-textconv --find-renames
 *            --src-prefix=a/ --dst-prefix=b/ --unified=3 <from> <to>
 */
import type { DiffLine, FileStatus } from "../model/change.js";

export interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section: string;
  lines: DiffLine[];
}

export interface ParsedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  similarity?: number;
  /** File modes from the header, e.g. `100644`, `100755`, `120000` for a symlink. */
  oldMode?: string;
  newMode?: string;
  hunks: ParsedHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export class DiffParseError extends Error {}

export function parseDiff(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const lines = text.split("\n");
  // A trailing newline leaves one empty string that is not a diff line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  let file: ParsedFile | null = null;
  let hunk: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    if (line.startsWith("diff --git ")) {
      file = startFile(line.slice("diff --git ".length));
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    // Inside a hunk, consume exactly the advertised number of lines. A content
    // line can itself start with "--- " or "diff --git ", so the counts, not
    // the prefixes, decide where the hunk ends.
    if (hunk && (oldRemaining > 0 || newRemaining > 0)) {
      const marker = line[0];
      const content = line.slice(1);
      if (marker === " " || (line === "" && oldRemaining > 0 && newRemaining > 0)) {
        hunk.lines.push({ kind: "context", content, oldLine: oldLine++, newLine: newLine++ });
        oldRemaining--;
        newRemaining--;
      } else if (marker === "-") {
        hunk.lines.push({ kind: "del", content, oldLine: oldLine++ });
        oldRemaining--;
      } else if (marker === "+") {
        hunk.lines.push({ kind: "add", content, newLine: newLine++ });
        newRemaining--;
      } else if (marker === "\\") {
        markNoNewline(hunk);
      } else {
        throw new DiffParseError(`Unexpected line ${i + 1} inside a hunk of ${file.path}: ${line}`);
      }
      continue;
    }

    if (line.startsWith("\\")) {
      if (hunk) markNoNewline(hunk);
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      hunk = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        section: header[5] ?? "",
        lines: [],
      };
      file.hunks.push(hunk);
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      oldRemaining = hunk.oldLines;
      newRemaining = hunk.newLines;
      continue;
    }

    if (line.startsWith("new file mode ")) {
      file.status = "added";
      file.newMode = line.slice("new file mode ".length);
    } else if (line.startsWith("deleted file mode ")) {
      file.status = "deleted";
      file.oldMode = line.slice("deleted file mode ".length);
    } else if (line.startsWith("old mode ")) file.oldMode = line.slice("old mode ".length);
    else if (line.startsWith("new mode ")) file.newMode = line.slice("new mode ".length);
    else if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.oldPath = unquote(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      file.path = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("copy from ")) {
      file.status = "copied";
      file.oldPath = unquote(line.slice("copy from ".length));
    } else if (line.startsWith("copy to ")) {
      file.path = unquote(line.slice("copy to ".length));
    } else if (line.startsWith("similarity index ")) {
      file.similarity = Number.parseInt(line.slice("similarity index ".length), 10);
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      file.binary = true;
    } else if (line.startsWith("+++ ")) {
      const path = stripPrefix(line.slice(4), "b/");
      if (path !== null) file.path = path;
    } else if (line.startsWith("--- ")) {
      const path = stripPrefix(line.slice(4), "a/");
      if (path !== null && file.status !== "added") file.oldPath ??= path;
    }
  }

  for (const f of files) {
    // "--- a/x" sets oldPath for every modified file; keep it only when the
    // file actually moved.
    if (f.oldPath === f.path) delete f.oldPath;
  }
  return files;
}

function startFile(rest: string): ParsedFile {
  // "a/<path> b/<path>". Unquoted paths may contain spaces, so for the usual
  // case (same path on both sides) split the line in half. Renames are fixed
  // up later from the "rename to" / "+++" lines.
  let path = rest;
  if (rest.startsWith('"')) {
    const end = findClosingQuote(rest);
    path = stripPrefix(rest.slice(end + 2), "b/") ?? rest;
  } else if (rest.startsWith("a/")) {
    const half = (rest.length - 1) / 2;
    if (Number.isInteger(half) && rest.slice(half, half + 3) === " b/") {
      path = rest.slice(half + 3);
    } else {
      const at = rest.indexOf(" b/");
      path = at === -1 ? rest.slice(2) : rest.slice(at + 3);
    }
  }
  return { path, status: "modified", binary: false, hunks: [] };
}

function markNoNewline(hunk: ParsedHunk): void {
  const last = hunk.lines[hunk.lines.length - 1];
  if (last) last.noNewlineAtEof = true;
}

function stripPrefix(raw: string, prefix: string): string | null {
  const value = unquote(raw.replace(/\t$/, ""));
  if (value === "/dev/null") return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function findClosingQuote(text: string): number {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
  }
  return text.length - 1;
}

/** Undoes git's C-style quoting of unusual paths. */
function unquote(raw: string): string {
  if (!(raw.startsWith('"') && raw.endsWith('"'))) return raw;
  const bytes: number[] = [];
  const body = raw.slice(1, -1);
  const simple: Record<string, number> = {
    n: 10,
    t: 9,
    r: 13,
    '"': 34,
    "\\": 92,
    a: 7,
    b: 8,
    f: 12,
    v: 11,
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      bytes.push(...new TextEncoder().encode(ch));
      continue;
    }
    const next = body[i + 1] as string;
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(simple[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

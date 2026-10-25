/**
 * Mechanical changes: edits a machine can check and a reviewer shouldn't have
 * to read. They're collapsed, not hidden, so a 10,000-line lockfile bump
 * can't drown the meaningful change or make the view depend on which PR
 * carried it.
 */
import picomatch from "picomatch";
import type { ParsedFile, ParsedHunk } from "../diff/parse.js";
import type { MechanicalVerdict } from "../model/change.js";
import type { LinguistAttributes } from "./gitattributes.js";

const LOCKFILES = picomatch(
  [
    "**/pnpm-lock.yaml",
    "**/package-lock.json",
    "**/npm-shrinkwrap.json",
    "**/yarn.lock",
    "**/bun.lock",
    "**/bun.lockb",
    "**/uv.lock",
    "**/poetry.lock",
    "**/Pipfile.lock",
    "**/Cargo.lock",
    "**/go.sum",
    "**/Gemfile.lock",
    "**/composer.lock",
    "**/Podfile.lock",
    "**/Package.resolved",
  ],
  { dot: true },
);

const GENERATED_PATHS = picomatch(
  [
    "**/generated/**",
    "**/__generated__/**",
    "**/*.generated.*",
    "**/*.gen.*",
    "**/*_pb2.py",
    "**/*_pb2_grpc.py",
    "**/*.pb.go",
    "**/*.min.{js,css}",
    "**/dist/**",
    "**/drizzle/meta/**",
  ],
  { dot: true },
);

const SNAPSHOTS = picomatch(["**/__snapshots__/**", "**/*.snap"], { dot: true });

/** Markers tools put near the top of files they generate. */
const GENERATED_MARKER =
  /@generated|Code generated .* DO NOT EDIT|\bDO NOT EDIT\b|auto-?generated/i;

const NO_ATTRIBUTES: LinguistAttributes = {
  generated: false,
  vendored: false,
  documentation: false,
};

export function mechanicalFile(
  file: ParsedFile,
  attributes: LinguistAttributes = NO_ATTRIBUTES,
): MechanicalVerdict | null {
  if (file.binary) return { kind: "binary", reason: "Binary file" };
  if (LOCKFILES(file.path)) return { kind: "lockfile", reason: "Dependency lockfile" };
  if (SNAPSHOTS(file.path)) return { kind: "snapshot", reason: "Test snapshot" };
  if (attributes.generated) {
    return { kind: "generated", reason: "Marked linguist-generated in .gitattributes" };
  }
  if (attributes.vendored) {
    return { kind: "vendored", reason: "Marked linguist-vendored in .gitattributes" };
  }
  if (GENERATED_PATHS(file.path)) return { kind: "generated", reason: "Generated-code path" };
  if (hasGeneratedMarker(file)) {
    return { kind: "generated", reason: "Says it's generated in its first lines" };
  }
  if (file.status === "renamed" && file.hunks.length === 0) {
    return { kind: "rename", reason: `Renamed from ${file.oldPath}, unchanged` };
  }
  return null;
}

/** For files that aren't mechanical as a whole: whitespace-only edits. */
export function mechanicalHunk(hunk: ParsedHunk): MechanicalVerdict | null {
  const removed = hunk.lines.filter((l) => l.kind === "del").map((l) => squash(l.content));
  const added = hunk.lines.filter((l) => l.kind === "add").map((l) => squash(l.content));
  if (removed.length === 0 && added.length === 0) return null;
  const same =
    removed.filter((l) => l !== "").join("\n") === added.filter((l) => l !== "").join("\n");
  return same ? { kind: "whitespace", reason: "Whitespace-only change" } : null;
}

function hasGeneratedMarker(file: ParsedFile): boolean {
  const first = file.hunks[0];
  if (!first || first.newStart > 5) return false;
  return first.lines
    .filter((l) => l.kind !== "del" && (l.newLine ?? 0) <= 5)
    .some((l) => GENERATED_MARKER.test(l.content));
}

function squash(line: string): string {
  return line.replace(/\s+/g, "");
}

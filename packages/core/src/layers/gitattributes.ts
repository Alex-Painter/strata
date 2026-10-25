/**
 * Reads the linguist attributes a repo sets in its root .gitattributes, the
 * ones GitHub uses to collapse diffs and leave files out of language stats:
 *
 *   linguist-generated      the file is generated; collapsed as mechanical
 *   linguist-vendored       the file is third-party code; collapsed as mechanical
 *   linguist-documentation  the file is documentation; the docs layer
 *
 * Git's own rules apply: later lines win, a pattern without a slash matches
 * the file name at any depth, and `-attr` or `attr=false` turns one off.
 * Nested .gitattributes files aren't read yet.
 */
import picomatch from "picomatch";

export interface LinguistAttributes {
  generated: boolean;
  vendored: boolean;
  documentation: boolean;
}

type Name = keyof LinguistAttributes;

const NAMES: Record<string, Name> = {
  "linguist-generated": "generated",
  "linguist-vendored": "vendored",
  "linguist-documentation": "documentation",
};

interface Line {
  match: (path: string) => boolean;
  /** Undefined means the line leaves the attribute as it was. */
  values: Partial<Record<Name, boolean | null>>;
}

export function parseGitAttributes(text: string): (path: string) => LinguistAttributes {
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    if (!pattern || pattern.startsWith("!")) continue;
    const values: Line["values"] = {};
    for (const attr of attrs) {
      const parsed = parseAttr(attr);
      if (parsed) values[parsed.name] = parsed.value;
    }
    if (Object.keys(values).length > 0) lines.push({ match: compile(pattern), values });
  }

  return (path) => {
    const result: LinguistAttributes = { generated: false, vendored: false, documentation: false };
    for (const line of lines) {
      if (!line.match(path)) continue;
      for (const [name, value] of Object.entries(line.values) as [Name, boolean | null][]) {
        // `!attr` makes it unspecified again, which is false here.
        result[name] = value ?? false;
      }
    }
    return result;
  };
}

function parseAttr(attr: string): { name: Name; value: boolean | null } | null {
  const unset = attr.startsWith("-");
  const unspecified = attr.startsWith("!");
  const body = unset || unspecified ? attr.slice(1) : attr;
  const [key = "", value] = body.split("=", 2);
  const name = NAMES[key];
  if (!name) return null;
  if (unspecified) return { name, value: null };
  if (unset) return { name, value: false };
  return { name, value: value === undefined || value === "true" };
}

/** A gitattributes pattern as a glob from the repo root. */
function compile(pattern: string): (path: string) => boolean {
  // A slash at the start or in the middle anchors the pattern to the root.
  const rooted = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
  const body = pattern.replace(/^\//, "");
  return picomatch(rooted ? body : `**/${body}`, { dot: true });
}

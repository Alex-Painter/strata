/**
 * Inspect rules flag files that must be right first time, whatever layer they
 * land in: access and permissions, deletion and retention (SPEC.md,
 * "Inspection by design"). They look for words in the path's folder and file
 * names, so a flag never depends on PR boundaries or an LLM, and its reason
 * names the word and where it was found. Unlike layer rules, every rule that
 * matches gives a flag.
 *
 * Names are split into words at punctuation, case changes and digits, and
 * case is ignored, so `useAuth.ts`, `user_auth.py` and `(auth)/` all have the
 * word "auth" while `author.py` doesn't, and `BlogIndex.tsx` has no "login".
 *
 * Tests and docs are never flagged, and nor are mechanical files (the
 * classifier leaves those out).
 */
import picomatch from "picomatch";
import type { InspectFlag, InspectRule, LayerId } from "../model/layers.js";

export const DEFAULT_INSPECT_RULES: InspectRule[] = [
  {
    id: "access",
    title: "Access and permissions",
    words: [
      "auth",
      "authn",
      "authz",
      "authenticat*",
      "unauthenticat*",
      "authoriz*",
      "unauthoriz*",
      "permission*",
      "rbac",
      "abac",
      "acl",
      "acls",
      "iam",
      "sso",
      "saml",
      "oauth",
      "omniauth",
      "openid",
      "oidc",
      "access control",
      "access policy",
      "access policies",
      "name:access",
      "name:policy",
      "name:policies",
      // Only in the file's name: Ansible, Chef and Puppet keep server roles in roles/ folders.
      "file:role",
      "file:roles",
      "rolebinding*",
      "clusterrole*",
      "name:ability",
      "name:abilities",
      "name:devise",
      "name:doorkeeper",
      "name:passport",
      "name:codeowners",
      "login*",
      "logout*",
      "log in",
      "log out",
      "signin",
      "signins",
      "sign in",
      "signup*",
      "sign up",
      "signout*",
      "sign out",
      "session*",
      "jwt",
      "jwts",
      "mfa",
      "2 fa",
      "two factor",
      "otp",
      "totp",
      "webauthn",
      "passkey*",
      "password*",
      "passwd",
      "htpasswd",
      "credential*",
      "secret",
      "secrets",
      "api key",
      "api keys",
      "apikey",
      "apikeys",
      "crypt",
      "crypto",
      "cryptography",
      "encrypt*",
      "decrypt*",
      "security",
      "tenant*",
      "tenancy",
      "impersonat*",
    ],
    paths: ["**/*.rego", "**/{firestore,storage,database}.rules"],
  },
  {
    id: "deletion",
    title: "Deletion and retention",
    words: [
      "delet*",
      "undelet*",
      "destroy*",
      "purg*",
      "erase",
      "erased",
      "erasure",
      "erasing",
      "wipe*",
      "trash*",
      "tombston*",
      "retention",
      "retain*",
      "expir*",
      "gdpr",
      "ccpa",
      "dsar",
      "anonymi*",
      "pseudonymi*",
      "redact*",
      "name:privacy",
      "cleanup*",
      "clean up",
      "prune*",
      "pruning",
      "archiv*",
      "backup*",
      "back up",
      "restor*",
    ],
    paths: [],
  },
];

/** Layers whose files are never flagged: a test or a doc can't break access or lose data. */
const UNFLAGGED: ReadonlySet<LayerId> = new Set(["tests", "docs"]);

type Entry =
  | { kind: "word" | "prefix" | "file" | "name"; text: string }
  | { kind: "words"; words: string[] };

/**
 * Reads one of a rule's words:
 * - `login`: that word, in any folder's name or the file's.
 * - `permission*`: a word that starts with it.
 * - `sign in`: those words next to each other in one name.
 * - `file:role`: that word in the file's own name only.
 * - `name:policy`: a folder, or a file before its extension, named just that.
 */
export function parseInspectWord(entry: string): Entry {
  if (!/^(name:|file:)?[a-z0-9]+(\*|( [a-z0-9]+)*)$/.test(entry)) {
    throw new Error(`Can't read the inspect word "${entry}".`);
  }
  if (entry.startsWith("name:")) return { kind: "name", text: entry.slice(5) };
  if (entry.startsWith("file:")) return { kind: "file", text: entry.slice(5) };
  if (entry.includes(" ")) return { kind: "words", words: entry.split(" ") };
  if (entry.endsWith("*")) return { kind: "prefix", text: entry.slice(0, -1) };
  return { kind: "word", text: entry };
}

/** The words in a folder or file name, lower case. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

interface Name {
  text: string;
  folder: boolean;
  words: string[];
  /** Before any extension, lower case. */
  bare: string;
}

/** The names in a path, the file's first. */
function names(path: string): Name[] {
  const parts = path.split("/");
  return parts
    .map((text, i) => ({
      text,
      folder: i < parts.length - 1,
      words: nameWords(text),
      bare: (text.replace(/^\.+/, "").split(".")[0] ?? "").toLowerCase(),
    }))
    .reverse();
}

/** What the entry found in the name, said plainly, or null. */
function find(entry: Entry, name: Name): string | null {
  switch (entry.kind) {
    case "word":
      return name.words.includes(entry.text) ? `the word "${entry.text}"` : null;
    case "file":
      return !name.folder && name.words.includes(entry.text) ? `the word "${entry.text}"` : null;
    case "prefix":
      return name.words.some((word) => word.startsWith(entry.text))
        ? `a word starting "${entry.text}"`
        : null;
    case "name":
      return name.bare === entry.text ? `the name "${entry.text}"` : null;
    case "words": {
      const { words } = entry;
      const found = name.words.some((_, i) => words.every((word, j) => name.words[i + j] === word));
      return found ? `the words "${words.join(" ")}"` : null;
    }
  }
}

/**
 * Builds a function that gives a file's flags from its path, then its old
 * path for a rename or copy, and the layer it finally landed in. A rule's
 * reason is the first of its words found in the file's name, then in its
 * folders from the nearest, or failing that the first of its globs to match.
 */
export function createInspector(
  rules: readonly InspectRule[] = DEFAULT_INSPECT_RULES,
): (file: { path: string; oldPath?: string }, layer: LayerId) => InspectFlag[] {
  const compiled = rules.map((rule) => ({
    rule,
    entries: rule.words.map(parseInspectWord),
    globs: rule.paths.map((glob) => ({
      glob,
      match: picomatch(glob, { dot: true, nocase: true }),
    })),
  }));
  return (file, layer) => {
    if (UNFLAGGED.has(layer)) return [];
    const paths = [{ path: file.path, names: names(file.path), where: "" }];
    if (file.oldPath !== undefined && file.oldPath !== file.path) {
      paths.push({ path: file.oldPath, names: names(file.oldPath), where: ", on its old path" });
    }
    const flags: InspectFlag[] = [];
    for (const { rule, entries, globs } of compiled) {
      let reason: string | null = null;
      for (const { path, names, where } of paths) {
        reason = wordReason(entries, names) ?? globReason(globs, path);
        if (reason) {
          reason += where;
          break;
        }
      }
      if (reason)
        flags.push({ rule: rule.id, title: rule.title, reason: `${rule.title}: ${reason}` });
    }
    return flags;
  };
}

function wordReason(entries: Entry[], names: Name[]): string | null {
  for (const name of names) {
    for (const entry of entries) {
      const what = find(entry, name);
      if (what) return `${what} in ${name.text}${name.folder ? "/" : ""}`;
    }
  }
  return null;
}

function globReason(
  globs: Array<{ glob: string; match: (path: string) => boolean }>,
  path: string,
): string | null {
  for (const { glob, match } of globs) if (match(path)) return `matches ${glob}`;
  return null;
}

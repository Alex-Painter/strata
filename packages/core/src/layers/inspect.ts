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
 * A joined name like `authmiddleware.ts` is caught by a word's start, with
 * the words a rule excepts (author, authority) never counted.
 *
 * Tests and docs are never flagged, and nor are translation catalogs or
 * mechanical files (the classifier leaves those out).
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
      "*authenticat*",
      "*authoriz*",
      "*authoris*",
      // Joined names like authmiddleware.ts; author and authority are excepted below.
      "auth*",
      // Not *oauth*, which coauthor has.
      "oauth*",
      "omniauth",
      "reauth*",
      "preauth*",
      "basicauth",
      "permission*",
      "privilege*",
      "rbac",
      "abac",
      "acl",
      "acls",
      "rls",
      "iam",
      "sso",
      "single sign on",
      "saml",
      "openid",
      "oidc",
      "ldap",
      "scim",
      "keycloak",
      "cognito",
      "okta",
      "casbin",
      "openfga",
      "spicedb",
      "access control",
      "access policy",
      "access policies",
      "access grant",
      "access grants",
      "grant access",
      "name:access",
      "name:policy",
      "name:policies",
      // Only in the file's name: Ansible, Chef and Puppet keep server roles in roles/ folders.
      "file:role",
      "file:roles",
      "rolebinding*",
      "clusterrole*",
      "is admin",
      "require admin",
      "requires admin",
      "admin required",
      "admin only",
      "superuser*",
      "sudoers",
      "impersonat*",
      "name:ability",
      "name:abilities",
      "name:devise",
      "name:doorkeeper",
      "name:passport",
      "name:codeowners",
      // Whole words only: loginfo and logoutput are logging.
      "login",
      "logins",
      "logout",
      "logouts",
      "log in",
      "log out",
      "signin",
      "signins",
      "sign in",
      "signup*",
      "sign up",
      "signout*",
      "sign out",
      "magic link",
      "magic links",
      "magiclink*",
      "protected route",
      "protected routes",
      "private route",
      "private routes",
      "session*",
      "*jwt*",
      "jwk",
      "jwks",
      "csrf",
      "xsrf",
      "api key",
      "api keys",
      "apikey",
      "apikeys",
      "api token",
      "api tokens",
      "access token",
      "access tokens",
      "refresh token",
      "refresh tokens",
      "verify token",
      "revok*",
      "revocation*",
      "mfa",
      "2 fa",
      "two fa",
      "twofa",
      "two factor",
      "multi factor",
      "multifactor",
      "otp",
      "otps",
      "totp",
      "*webauthn*",
      "passkey*",
      "passcode*",
      "biometric*",
      "*password*",
      "*passwd*",
      "*credential*",
      "secret",
      "*secrets*",
      "kms",
      "sops",
      "keyvault",
      "key vault",
      "crypt",
      "crypto",
      "cryptography",
      "*encrypt*",
      "*decrypt*",
      "security",
      "tenant*",
      "tenancy",
      "multitenan*",
    ],
    except: [
      "author",
      "authors",
      "authored",
      "authoring",
      "authorship",
      "authority",
      "authorities",
    ],
    paths: [
      "**/*.rego",
      "**/{firestore,storage,database}.rules{,.json}",
      "**/*.{pem,key,p12,pfx}",
      "**/id_{rsa,ecdsa,ed25519}",
    ],
  },
  {
    id: "deletion",
    title: "Deletion and retention",
    words: [
      "*delet*",
      "destroy*",
      "*purg*",
      "erase",
      "erased",
      "erasure",
      "erasing",
      "wipe*",
      "*trash*",
      "tombston*",
      "*retention*",
      "retain*",
      "expir*",
      "*gdpr*",
      "ccpa",
      "dsar",
      "rtbf",
      "data subject",
      "forget",
      "forgotten",
      "*anonymi*",
      "*pseudonymi*",
      "*redact*",
      "name:privacy",
      "*cleanup*",
      "clean up",
      "prune*",
      "pruning",
      // Only in the file's name: an archive/ folder holds old code, not code that archives.
      "file:*archiv*",
      "*backup*",
      "back up",
      "restor*",
    ],
    except: [],
    paths: [],
  },
];

/**
 * Translation catalogs: their words are about logins and deletion, but they
 * hold none of the code that does either.
 */
const CATALOGS = [
  "**/{locale,locales,i18n,l10n,lang,langs,translation,translations}/**/*.{json,yml,yaml,po,pot,xliff,xlf,properties,arb,ftl,strings,resx,php}",
  "**/*.{po,pot,xliff,xlf,arb,strings}",
];

/** Layers whose files are never flagged: a test or a doc can't break access or lose data. */
const UNFLAGGED: ReadonlySet<LayerId> = new Set(["tests", "docs"]);

type Entry = (
  | { kind: "word" | "prefix" | "infix" | "name"; text: string }
  | { kind: "words"; words: string[] }
) & {
  /** Found in the file's own name only, never a folder's. */
  fileOnly: boolean;
};

/**
 * Reads one of a rule's words:
 * - `login`: that word, in any folder's name or the file's.
 * - `permission*`: a word that starts with it.
 * - `*password*`: a word that has it anywhere, as `resetpassword` does.
 * - `sign in`: those words next to each other in one name.
 * - `file:` before any of those: in the file's own name only, as `file:role`.
 * - `name:policy`: a folder, or a file before its extension, named just that.
 */
export function parseInspectWord(entry: string): Entry {
  if (!/^(name:[a-z0-9]+|(file:)?([a-z0-9]+(\*|( [a-z0-9]+)*)|\*[a-z0-9]+\*))$/.test(entry)) {
    throw new Error(`Strata cannot read the inspect word "${entry}".`);
  }
  if (entry.startsWith("name:")) return { kind: "name", text: entry.slice(5), fileOnly: false };
  const fileOnly = entry.startsWith("file:");
  const word = fileOnly ? entry.slice(5) : entry;
  if (word.includes(" ")) return { kind: "words", words: word.split(" "), fileOnly };
  if (word.startsWith("*")) return { kind: "infix", text: word.slice(1, -1), fileOnly };
  if (word.endsWith("*")) return { kind: "prefix", text: word.slice(0, -1), fileOnly };
  return { kind: "word", text: word, fileOnly };
}

/** The words in a folder or file name, lower case. A plural acronym like ACLs is one word, acl. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([A-Z]{2,})s(?![a-z])/g, "$1 ")
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

/** What the entry found in the name, said plainly, or null. A word in `except` is never found alone. */
function find(entry: Entry, name: Name, except: ReadonlySet<string>): string | null {
  if (entry.fileOnly && name.folder) return null;
  const words = name.words.filter((word) => !except.has(word));
  switch (entry.kind) {
    case "word":
      return words.includes(entry.text) ? `the word "${entry.text}"` : null;
    case "prefix":
      return words.some((word) => word.startsWith(entry.text))
        ? `a word starting "${entry.text}"`
        : null;
    case "infix": {
      const word = words.find((word) => word.includes(entry.text));
      if (word === undefined) return null;
      return word.startsWith(entry.text)
        ? `a word starting "${entry.text}"`
        : `a word containing "${entry.text}"`;
    }
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
    except: new Set(rule.except),
    globs: rule.paths.map((glob) => ({
      glob,
      match: picomatch(glob, { dot: true, nocase: true }),
    })),
  }));
  const catalog = picomatch(CATALOGS, { dot: true, nocase: true });
  return (file, layer) => {
    if (UNFLAGGED.has(layer) || catalog(file.path)) return [];
    const paths = [{ path: file.path, names: names(file.path), where: "" }];
    if (file.oldPath !== undefined && file.oldPath !== file.path) {
      paths.push({ path: file.oldPath, names: names(file.oldPath), where: ", on its old path" });
    }
    const flags: InspectFlag[] = [];
    for (const { rule, entries, except, globs } of compiled) {
      let reason: string | null = null;
      for (const { path, names, where } of paths) {
        reason = wordReason(entries, names, except) ?? globReason(globs, path);
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

function wordReason(entries: Entry[], names: Name[], except: ReadonlySet<string>): string | null {
  for (const name of names) {
    for (const entry of entries) {
      const what = find(entry, name, except);
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

/**
 * Inspect rules flag files that must be right first time, whatever layer they
 * land in: access and permissions, deletion and retention (SPEC.md,
 * "Inspection by design"). Like layer rules they are plain globs over the
 * path, so a flag never depends on PR boundaries or an LLM, and its reason
 * names the glob that matched. Unlike layer rules, they ignore case and every
 * rule that matches gives a flag.
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
    paths: [
      "**/{auth,authn,authz,authentication,authorization}/**",
      "**/{auth,authn,authz,authentication,authorization}.*",
      "**/{*_,*-}auth.*",
      "**/auth{_,-}*.*",
      "**/*{authenticat,authoriz}*.*",
      // camelCase names, which can't be told from author or authority ignoring case.
      "**/{use,with,require}auth*.*",
      "**/auth{provider,context,guard,service,store,client,callback,gate,state}*.*",
      "**/{permission,permissions,policies,rbac,acl,acls,roles,iam,sso,saml,oauth,oauth2}/**",
      "**/*{permission,rbac,oauth,saml}*.*",
      "**/{acl,acls,roles,policy,policies}.*",
      "**/*{_,-}{acl,acls,roles,policy,policies}.*",
      "**/*{login,logout,signin,signup,session}*.*",
      "**/*{password,passwd,credential,secret,api_key,apikey}*.*",
      "**/*{crypt,encrypt,decrypt}*.*",
      "**/{middleware,middlewares}/*{auth,permission,tenant}*.*",
      "**/*{tenant,impersonat}*.*",
      "**/CODEOWNERS",
      "**/*.rego",
      "**/{firestore,storage,database}.rules",
    ],
  },
  {
    id: "deletion",
    title: "Deletion and retention",
    paths: [
      "**/*{delete,deletion,deleted,deleting}*.*",
      "**/*{purge,erase,erasure}*.*",
      "**/*{retention,retain,expire,expiry,expiration}*.*",
      "**/*{gdpr,ccpa,dsar,anonymi,pseudonymi,redact}*.*",
      "**/*{cleanup,clean_up,prune,pruning,archive,archival}*.*",
      // Only at the start of a word, so firestore and swipe don't match.
      "**/{backup,restore,wipe}*.*",
      "**/*{_,-,.}{backup,restore,wipe}*.*",
      "**/{retention,gdpr,privacy,cleanup,purge,backup,backups}/**",
    ],
  },
];

/** Layers whose files are never flagged: a test or a doc can't break access or lose data. */
const UNFLAGGED: ReadonlySet<LayerId> = new Set(["tests", "docs"]);

/**
 * Builds a function that gives a file's flags from its path, then its old
 * path for a rename or copy, and the layer it finally landed in.
 */
export function createInspector(
  rules: readonly InspectRule[] = DEFAULT_INSPECT_RULES,
): (file: { path: string; oldPath?: string }, layer: LayerId) => InspectFlag[] {
  const compiled = rules.map((rule) => ({
    rule,
    globs: rule.paths.map((glob) => ({
      glob,
      match: picomatch(glob, { dot: true, nocase: true }),
    })),
  }));
  return (file, layer) => {
    if (UNFLAGGED.has(layer)) return [];
    const flags: InspectFlag[] = [];
    for (const { rule, globs } of compiled) {
      const reason = reasonFor(rule, globs, file);
      if (reason) flags.push({ rule: rule.id, title: rule.title, reason });
    }
    return flags;
  };
}

function reasonFor(
  rule: InspectRule,
  globs: Array<{ glob: string; match: (path: string) => boolean }>,
  file: { path: string; oldPath?: string },
): string | null {
  for (const { glob, match } of globs) {
    if (match(file.path)) return `${rule.title}: matches ${glob}`;
  }
  if (file.oldPath === undefined) return null;
  for (const { glob, match } of globs) {
    if (match(file.oldPath)) return `${rule.title}: its old path matches ${glob}`;
  }
  return null;
}

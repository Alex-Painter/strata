import { describe, expect, it } from "vitest";
import { type ParsedFile, type ParsedHunk, parseDiff } from "./diff/parse.js";
import { createClassifier } from "./layers/classify.js";
import { parseGitAttributes } from "./layers/gitattributes.js";
import {
  createInspector,
  DEFAULT_INSPECT_RULES,
  nameWords,
  parseInspectWord,
} from "./layers/inspect.js";
import { mechanicalFile, mechanicalHunk } from "./layers/mechanical.js";
import { createPathClassifier } from "./layers/rules.js";
import type { LayerAssignment } from "./model/change.js";
import { compareLayers, LAYER_IDS, LAYERS } from "./model/layers.js";

describe("layer definitions", () => {
  it("define every layer once, in review order", () => {
    expect(Object.keys(LAYERS).sort()).toEqual([...LAYER_IDS].sort());
    const ordered = [...LAYER_IDS].sort(compareLayers);
    expect(ordered).toEqual([...LAYER_IDS]);
  });
});

/**
 * The layer table is what a reviewer relies on, so it's tested as a table: a
 * path and the layer a reviewer would expect. Add a row whenever a rule
 * changes or a real repo is misclassified. The maverick rows are the paths
 * the plan expects; check them against the real repo on the Mac.
 */
const CASES: [path: string, layer: string][] = [
  // Tests win over everything, UI extensions included.
  ["src/components/Button.test.tsx", "tests"],
  ["maverick/tests/test_deal.py", "tests"],
  ["tests/conftest.py", "tests"],
  ["src/__snapshots__/view.test.ts.snap", "tests"],
  ["pkg/thing_test.go", "tests"],
  ["frontend/src/App.test.tsx", "tests"],
  // Data model.
  ["maverick/data_models/deal.py", "data-model"],
  ["app/models/user.rb", "data-model"],
  ["prisma/schema.prisma", "data-model"],
  ["migrations/0042_add_index.sql", "data-model"],
  ["apps/server/drizzle/0001_init.sql", "data-model"],
  ["alembic/versions/abc_add_column.py", "data-model"],
  // API.
  ["maverick/outbound/routers/accounts.py", "api"],
  ["maverick/schemas/crm.py", "api"],
  ["src/api/users.ts", "api"],
  ["openapi.yaml", "api"],
  ["proto/service.proto", "api"],
  // Config and infra.
  [".github/workflows/ci.yml", "config"],
  ["Dockerfile_api", "config"],
  ["docker/api.Dockerfile", "config"],
  ["package.json", "config"],
  ["pnpm-lock.yaml", "config"],
  ["pyproject.toml", "config"],
  ["uv.lock", "config"],
  ["vite.config.ts", "config"],
  ["cloudformation.yml", "config"],
  [".gitattributes", "config"],
  // Docs.
  ["README.md", "docs"],
  ["docs/architecture.md", "docs"],
  // UI: the whole frontend app, then UI files anywhere.
  ["frontend/src/App.tsx", "ui"],
  ["frontend/src/api/client.ts", "ui"],
  ["frontend/src/models/deal.ts", "ui"],
  ["src/styles/global.css", "ui"],
  ["src/components/Card.ts", "ui"],
  // Fallbacks.
  ["src/lib/pricing.ts", "logic"],
  ["maverick/utils/access.py", "logic"],
  ["assets/logo.svg", "other"],
];

describe("default layer rules", () => {
  const classify = createPathClassifier();

  it.each(CASES)("%s → %s", (path, layer) => {
    expect(classify(path).layer).toBe(layer);
  });

  it("names the glob that matched, and marks fallbacks as low confidence", () => {
    expect(classify("migrations/1.sql")).toEqual({
      layer: "data-model",
      by: "rule",
      reason: "Database migration or SQL: matches **/migrations/**",
      confidence: "high",
    });
    expect(classify("src/lib/pricing.ts")).toMatchObject({ by: "default", confidence: "low" });
    expect(classify("assets/logo.svg")).toMatchObject({ layer: "other", confidence: "low" });
  });

  it("runs repo rules before the defaults", () => {
    const custom = createPathClassifier([
      {
        id: "billing",
        layer: "data-model",
        paths: ["billing/**"],
        reason: "Billing is always inspected",
      },
    ]);
    expect(custom("billing/invoice.ts")).toMatchObject({
      layer: "data-model",
      reason: "Billing is always inspected: matches billing/**",
    });
    expect(custom("src/lib/pricing.ts").layer).toBe("logic");
  });
});

/**
 * Inspect rules, as a table too: a path and the rules a reviewer would expect
 * it to set off, for a file in Logic. The near misses matter as much as the
 * hits, since a flag on every file means nothing.
 */
const INSPECT_CASES: [path: string, rules: string[]][] = [
  // Access and permissions, in a folder's name or the file's, in any case.
  ["app/auth/tokens.py", ["access"]],
  ["src/Auth/Session.ts", ["access"]],
  ["AUTH/keys.py", ["access"]],
  ["app/user_auth.py", ["access"]],
  ["src/hooks/useAuth.ts", ["access"]],
  ["src/AuthProvider.tsx", ["access"]],
  ["app/(auth)/layout.tsx", ["access"]],
  ["app/authentication_backend.py", ["access"]],
  ["app/api/permissions.py", ["access"]],
  ["app/rbac/grants.py", ["access"]],
  ["src/user-roles.ts", ["access"]],
  ["app/models/role.rb", ["access"]],
  ["charts/app/templates/clusterrole.yaml", ["access"]],
  ["policies/billing.rego", ["access"]],
  ["app/models/ability.rb", ["access"]],
  ["frontend/src/pages/Login.tsx", ["access"]],
  ["app/sign-in/page.tsx", ["access"]],
  ["src/components/SignOutButton.tsx", ["access"]],
  ["app/views/sessions/new.html.erb", ["access"]],
  ["app/oauth_client.py", ["access"]],
  ["internal/middleware/jwt.go", ["access"]],
  ["backend/app/core/security.py", ["access"]],
  ["src/2fa.ts", ["access"]],
  ["scripts/rotate-secrets", ["access"]],
  ["app/middleware/tenant_scope.py", ["access"]],
  ["infra/iam.tf", ["access"]],
  [".github/CODEOWNERS", ["access"]],
  ["firestore.rules", ["access"]],
  ["maverick/utils/access.py", ["access"]],
  // Joined names, and plural acronyms.
  ["app/middleware/authmiddleware.py", ["access"]],
  ["internal/authhandler.go", ["access"]],
  ["app/reauth.py", ["access"]],
  ["src/basicauth.go", ["access"]],
  ["app/services/resetpassword.py", ["access"]],
  ["src/UnauthorisedPage.tsx", ["access"]],
  ["app/multitenant/scope.py", ["access"]],
  ["src/ACLsTable.tsx", ["access"]],
  ["src/OTPsForm.tsx", ["access"]],
  // Tokens, routes, admin checks and the like.
  ["app/api_tokens.py", ["access"]],
  ["app/services/access_token_store.py", ["access"]],
  ["app/jwks.py", ["access"]],
  ["app/csrf.py", ["access"]],
  ["src/routes/ProtectedRoute.tsx", ["access"]],
  ["app/decorators/admin_only.py", ["access"]],
  ["src/hooks/isAdmin.ts", ["access"]],
  ["app/privileges.py", ["access"]],
  ["app/superuser.py", ["access"]],
  ["etc/sudoers", ["access"]],
  ["app/services/revoke_invite.py", ["access"]],
  ["migrations/0007_enable_rls.sql", ["access"]],
  ["app/twofa/setup.py", ["access"]],
  ["src/MultiFactorSetup.tsx", ["access"]],
  ["src/BiometricPrompt.tsx", ["access"]],
  ["app/ldap_sync.py", ["access"]],
  ["app/scim/users.py", ["access"]],
  ["src/MagicLink.tsx", ["access"]],
  ["infra/keyvault.bicep", ["access"]],
  ["infra/kms.tf", ["access"]],
  ["certs/server.pem", ["access"]],
  ["deploy/id_ed25519", ["access"]],
  ["database.rules.json", ["access"]],
  // Deletion and retention.
  ["app/jobs/retention.py", ["deletion"]],
  ["scripts/purge_old_rows.py", ["deletion"]],
  ["app/services/delete_account.py", ["deletion"]],
  ["internal/deletion/worker.go", ["deletion"]],
  ["app/services/users/destroy_service.rb", ["deletion"]],
  ["src/EmptyTrash.tsx", ["deletion"]],
  ["app/gdpr/export.py", ["deletion"]],
  ["scripts/pg_restore.sh", ["deletion"]],
  ["app/backups/run.sh", ["deletion"]],
  ["bin/anonymize_users", ["deletion"]],
  ["app/models/concerns/softdelete.rb", ["deletion"]],
  ["app/services/call_archiver.py", ["deletion"]],
  ["src/Unarchive.tsx", ["deletion"]],
  ["app/dataretention.py", ["deletion"]],
  ["app/services/forget_user.py", ["deletion"]],
  ["app/rtbf/handler.py", ["deletion"]],
  ["app/data_subject_requests.py", ["deletion"]],
  ["migrations/0043_archive_sessions.sql", ["access", "deletion"]],
  // Near misses: a keyword inside another word, or a word used another way.
  ["app/author.py", []],
  ["app/authority.py", []],
  ["src/AuthorCard.tsx", []],
  ["src/hooks/useAuthor.ts", []],
  ["src/components/Accessibility.tsx", []],
  ["src/components/BlogIndex.tsx", []],
  ["src/components/DialogInput.tsx", []],
  ["src/http/logInterceptor.ts", []],
  ["src/components/DesignInspector.tsx", []],
  ["app/signing_key.py", []],
  ["app/secretary.py", []],
  ["app/controller.py", []],
  ["app/processor.py", []],
  ["src/footprint.ts", []],
  ["app/firestore_client.py", []],
  ["src/Swipeable.tsx", []],
  ["src/Eraser.tsx", []],
  ["ansible/roles/web/tasks/main.yml", []],
  ["internal/grpc/retry_policy.go", []],
  ["pages/privacy-policy.tsx", []],
  ["app/middleware/logging.py", []],
  ["app/services/export.py", []],
  ["web/admin/CacheStats.tsx", []],
  ["src/AuthorsList.tsx", []],
  ["src/coauthor.ts", []],
  ["app/lieutenant.py", []],
  ["app/logging/loginfo.py", []],
  ["app/logoutput.py", []],
  // An archive/ folder holds old code, not code that archives.
  ["scripts/archive/send_weekly_report.py", []],
  // Translation catalogs are words about logins and deletion, not code.
  ["config/locales/devise.en.yml", []],
  ["src/locales/en/auth.json", []],
  ["resources/lang/en/passwords.php", []],
  ["app/po/permissions.po", []],
];

describe("inspect rules", () => {
  const inspect = createInspector();

  it("are all words Strata can read", () => {
    for (const rule of DEFAULT_INSPECT_RULES) {
      for (const word of rule.words) expect(() => parseInspectWord(word)).not.toThrow();
      // A name is split into words like these, so an exception of any other form never applies.
      for (const word of rule.except) expect(word).toMatch(/^[a-z0-9]+$/);
    }
    expect(() => parseInspectWord("Login")).toThrow();
    expect(() => parseInspectWord("sign*in")).toThrow();
    expect(() => parseInspectWord("*sign in*")).toThrow();
    expect(() => parseInspectWord("name:polic*")).toThrow();
    expect(() => parseInspectWord("file:name:role")).toThrow();
    expect(parseInspectWord("*password*")).toEqual({
      kind: "infix",
      text: "password",
      fileOnly: false,
    });
    expect(parseInspectWord("file:*archiv*")).toEqual({
      kind: "infix",
      text: "archiv",
      fileOnly: true,
    });
  });

  it("split names into words at punctuation, case changes and digits", () => {
    expect(nameWords("SignOutButton.tsx")).toEqual(["sign", "out", "button", "tsx"]);
    expect(nameWords("OAuth2Client")).toEqual(["o", "auth", "2", "client"]);
    expect(nameWords("APIKeyForm")).toEqual(["api", "key", "form"]);
    expect(nameWords("[[...sign-in]]")).toEqual(["sign", "in"]);
    expect(nameWords(".htpasswd")).toEqual(["htpasswd"]);
    expect(nameWords("ACLsTable.tsx")).toEqual(["acl", "table", "tsx"]);
    expect(nameWords("userIDs")).toEqual(["user", "id"]);
    expect(nameWords("URLsafe")).toEqual(["ur", "lsafe"]);
  });

  it.each(INSPECT_CASES)("%s → %j", (path, rules) => {
    expect(inspect({ path }, "logic").map((flag) => flag.rule)).toEqual(rules);
  });

  it("say which word was found and where, in rule order", () => {
    expect(inspect({ path: "migrations/0043_archive_sessions.sql" }, "data-model")).toEqual([
      {
        rule: "access",
        title: "Access and permissions",
        reason: 'Access and permissions: a word starting "session" in 0043_archive_sessions.sql',
      },
      {
        rule: "deletion",
        title: "Deletion and retention",
        reason: 'Deletion and retention: a word starting "archiv" in 0043_archive_sessions.sql',
      },
    ]);
    const reason = (path: string) => inspect({ path }, "logic")[0]?.reason;
    expect(reason("app/auth/tokens.py")).toBe('Access and permissions: the word "auth" in auth/');
    expect(reason("src/pages/sign-up.tsx")).toBe(
      'Access and permissions: the words "sign up" in sign-up.tsx',
    );
    expect(reason("policies/billing.rego")).toBe(
      'Access and permissions: the name "policies" in policies/',
    );
    expect(reason("firestore.rules")).toBe(
      "Access and permissions: matches **/{firestore,storage,database}.rules{,.json}",
    );
  });

  it("look at the file's name, then its folders from the nearest", () => {
    const reason = (path: string) => inspect({ path }, "logic")[0]?.reason;
    expect(reason("app/auth/permissions.py")).toBe(
      'Access and permissions: a word starting "permission" in permissions.py',
    );
    expect(reason("app/(auth)/login/page.tsx")).toBe(
      'Access and permissions: the word "login" in login/',
    );
  });

  it("say when the word was inside a longer one", () => {
    const reason = (path: string) => inspect({ path }, "logic")[0]?.reason;
    expect(reason("app/services/resetpassword.py")).toBe(
      'Access and permissions: a word containing "password" in resetpassword.py',
    );
    expect(reason("app/passwords.py")).toBe(
      'Access and permissions: a word starting "password" in passwords.py',
    );
    expect(reason("app/middleware/authmiddleware.py")).toBe(
      'Access and permissions: a word starting "auth" in authmiddleware.py',
    );
  });

  it("flag a file moved away from a matching path, and say so", () => {
    expect(
      inspect({ path: "app/users/tokens.py", oldPath: "app/auth/tokens.py" }, "logic"),
    ).toEqual([
      {
        rule: "access",
        title: "Access and permissions",
        reason: 'Access and permissions: the word "auth" in auth/, on its old path',
      },
    ]);
    // Where both paths match, the new one is the reason.
    expect(
      inspect({ path: "app/auth/users.py", oldPath: "app/auth/tokens.py" }, "logic")[0]?.reason,
    ).toBe('Access and permissions: the word "auth" in auth/');
  });

  it("only count archiving in a file's own name, not a folder of old code", () => {
    expect(inspect({ path: "scripts/archive/2023/backfill.py" }, "logic")).toEqual([]);
    expect(inspect({ path: "scripts/archive/archive_calls.py" }, "logic")[0]?.reason).toBe(
      'Deletion and retention: a word starting "archiv" in archive_calls.py',
    );
  });

  it("only count roles in a file's own name, not a folder of server roles", () => {
    expect(inspect({ path: "roles/postgres/defaults/main.yml" }, "config")).toEqual([]);
    expect(inspect({ path: "app/roles.py" }, "logic").map((flag) => flag.rule)).toEqual(["access"]);
  });

  it("flags any layer but Tests and Docs", () => {
    for (const layer of LAYER_IDS) {
      const flags = inspect({ path: "app/auth/tokens.py" }, layer);
      expect(flags.length, layer).toBe(layer === "tests" || layer === "docs" ? 0 : 1);
    }
  });

  it("goes by the layer the classifier settled on, and skips mechanical files", () => {
    const classifier = createClassifier({
      gitattributes: "web/auth/*.html linguist-documentation\nclients/** linguist-generated\n",
      judged: new Map([
        [
          "scripts/purge.sh",
          { layer: "tests", by: "llm", reason: "A test harness", confidence: "medium" },
        ],
      ]),
    });
    const [doc, generated, judged, test, plain] = parseDiff(
      [
        diffAdding("web/auth/index.html", "<h1>Auth</h1>"),
        diffAdding("clients/permissions.ts", "export {};"),
        diffAdding("scripts/purge.sh", "echo"),
        diffAdding("tests/test_permissions.py", "def test(): ..."),
        diffAdding("app/permissions.py", "x = 1"),
      ].join(""),
    ) as ParsedFile[];
    const flags = (file: ParsedFile | undefined) => {
      const parsed = file as ParsedFile;
      const layer = classifier.layer(parsed);
      return classifier
        .inspect(parsed, layer, classifier.mechanicalFile(parsed))
        .map((f) => f.rule);
    };
    expect(flags(doc)).toEqual([]);
    expect(flags(generated)).toEqual([]);
    expect(flags(judged)).toEqual([]);
    expect(flags(test)).toEqual([]);
    expect(flags(plain)).toEqual(["access"]);
  });
});

describe(".gitattributes", () => {
  const attributes = parseGitAttributes(
    [
      "# Generated clients",
      "*.pb.go linguist-generated",
      "/clients/** linguist-generated=true",
      "clients/handwritten.ts -linguist-generated",
      "vendor/** linguist-vendored",
      "docs/api/*.html linguist-documentation",
      "*.png binary",
    ].join("\n"),
  );

  it("reads the linguist attributes, later lines winning", () => {
    expect(attributes("api/v1/service.pb.go").generated).toBe(true);
    expect(attributes("clients/billing.ts").generated).toBe(true);
    expect(attributes("clients/handwritten.ts").generated).toBe(false);
    expect(attributes("vendor/lib/x.js")).toEqual({
      generated: false,
      vendored: true,
      documentation: false,
    });
    expect(attributes("docs/api/index.html").documentation).toBe(true);
  });

  it("anchors patterns with a slash to the root, and matches others at any depth", () => {
    expect(attributes("sub/clients/billing.ts").generated).toBe(false);
    expect(attributes("deep/down/x.pb.go").generated).toBe(true);
    expect(attributes("logo.png")).toEqual({
      generated: false,
      vendored: false,
      documentation: false,
    });
  });

  it("feeds the classifier: documentation is docs, generated is mechanical", () => {
    const classifier = createClassifier({
      gitattributes: "docs/api/*.html linguist-documentation\nclients/** linguist-generated\n",
    });
    const [html, client] = parseDiff(
      [
        diffAdding("docs/api/index.html", "<h1>API</h1>"),
        diffAdding("clients/billing.ts", "export {};"),
      ].join(""),
    );
    expect(classifier.layer(html as ParsedFile)).toMatchObject({ layer: "docs", by: "rule" });
    expect(classifier.mechanicalFile(client as ParsedFile)).toEqual({
      kind: "generated",
      reason: "Marked linguist-generated in .gitattributes",
    });
  });
});

describe("Claude's judgements", () => {
  it("apply only where the rules have nothing better than a guess", () => {
    const judgement: LayerAssignment = {
      layer: "data-model",
      by: "llm",
      reason: "Defines the invoice table",
      confidence: "medium",
    };
    const classifier = createClassifier({
      judged: new Map([
        ["app/invoices.py", judgement],
        ["app/routers/x.py", { ...judgement, layer: "logic" }],
      ]),
    });
    const [guessed, ruled, unasked] = parseDiff(
      [
        diffAdding("app/invoices.py", "class Invoice: ..."),
        diffAdding("app/routers/x.py", "router = None"),
        diffAdding("app/other.py", "x = 1"),
      ].join(""),
    );
    expect(classifier.layer(guessed as ParsedFile)).toEqual(judgement);
    expect(classifier.layer(ruled as ParsedFile)).toMatchObject({ layer: "api", by: "rule" });
    expect(classifier.layer(unasked as ParsedFile)).toMatchObject({
      layer: "logic",
      by: "default",
    });
  });
});

describe("mechanical changes", () => {
  const file = (diff: string) => parseDiff(diff)[0] as ParsedFile;

  it("collapses lockfiles, snapshots, generated code, binaries and pure renames", () => {
    expect(mechanicalFile(file(diffAdding("uv.lock", "x")))?.kind).toBe("lockfile");
    expect(mechanicalFile(file(diffAdding("src/__snapshots__/a.snap", "x")))?.kind).toBe(
      "snapshot",
    );
    expect(mechanicalFile(file(diffAdding("api/types.generated.ts", "x")))?.kind).toBe("generated");
    expect(
      mechanicalFile(file(diffAdding("api/client.ts", "// Code generated by oapi. DO NOT EDIT.")))
        ?.kind,
    ).toBe("generated");
    expect(
      mechanicalFile(
        file(
          "diff --git a/a.png b/a.png\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/a.png differ\n",
        ),
      ),
    ).toEqual({ kind: "binary", reason: "Binary file" });
    expect(
      mechanicalFile(
        file(
          "diff --git a/old.md b/new.md\nsimilarity index 100%\nrename from old.md\nrename to new.md\n",
        ),
      ),
    ).toEqual({ kind: "rename", reason: "Renamed from old.md, unchanged" });
    expect(mechanicalFile(file(diffAdding("src/app.ts", "export const a = 1;")))).toBeNull();
  });

  it("collapses whitespace-only hunks, and nothing else", () => {
    const [hunk] = file(
      "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1,2 +1,2 @@\n-def f(a,b):\n-  return a+b\n+def f(a, b):\n+    return a + b\n",
    ).hunks;
    expect(mechanicalHunk(hunk as ParsedHunk)).toEqual({
      kind: "whitespace",
      reason: "Whitespace-only change",
    });
    const [real] = file(
      "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-return a+b\n+return a-b\n",
    ).hunks;
    expect(mechanicalHunk(real as ParsedHunk)).toBeNull();
  });
});

function diffAdding(path: string, line: string): string {
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${line}\n`;
}

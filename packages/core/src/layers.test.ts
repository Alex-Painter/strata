import { describe, expect, it } from "vitest";
import { type ParsedFile, type ParsedHunk, parseDiff } from "./diff/parse.js";
import { createClassifier } from "./layers/classify.js";
import { parseGitAttributes } from "./layers/gitattributes.js";
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

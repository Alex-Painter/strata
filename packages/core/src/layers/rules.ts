/**
 * Path rules that assign files to layers. Rules run in order and the first
 * match wins, so specific rules (tests, the frontend, migrations) come before
 * broad ones (any .tsx is UI). A repo's own rules run before these.
 *
 * Rules are deliberately boring globs: a reviewer can read why a file landed
 * where it did, and the result never depends on PR boundaries or an LLM.
 */
import picomatch from "picomatch";
import type { LayerAssignment } from "../model/change.js";
import type { LayerRule } from "../model/layers.js";

export const DEFAULT_LAYER_RULES: LayerRule[] = [
  {
    id: "tests",
    layer: "tests",
    paths: [
      "**/*.{test,spec}.*",
      "**/__tests__/**",
      "**/__snapshots__/**",
      "**/*.snap",
      "**/test/**",
      "**/tests/**",
      "**/test_*.py",
      "**/*_test.{py,go,rb}",
      "**/conftest.py",
      "**/fixtures/**",
      "**/e2e/**",
      "**/cypress/**",
      "**/playwright/**",
    ],
    reason: "Test file or fixture",
  },
  {
    // Before the model and API rules, so a frontend's own models/ and api/
    // folders count as client code.
    id: "frontend",
    layer: "ui",
    paths: ["frontend/**", "**/frontend/**"],
    reason: "Frontend app",
  },
  {
    id: "migrations",
    layer: "data-model",
    paths: ["**/migrations/**", "**/alembic/**", "**/*.sql", "**/db/schema.rb"],
    reason: "Database migration or SQL",
  },
  {
    id: "models",
    layer: "data-model",
    paths: [
      "**/*.prisma",
      "**/models/**",
      "**/models.py",
      "**/data_models/**",
      "**/entities/**",
      "**/db/schema.*",
      "**/drizzle/**",
    ],
    reason: "Persisted model or schema definition",
  },
  {
    id: "api-contracts",
    layer: "api",
    paths: [
      "**/openapi.{json,yaml,yml}",
      "**/*.openapi.{json,yaml,yml}",
      "**/swagger.{json,yaml,yml}",
      "**/*.proto",
      "**/*.graphql",
      "**/*.gql",
    ],
    reason: "API contract",
  },
  {
    id: "api",
    layer: "api",
    paths: [
      "**/api/**",
      "**/routes/**",
      "**/routers/**",
      "**/controllers/**",
      "**/handlers/**",
      "**/endpoints/**",
      "**/views.py",
      "**/schemas/**",
      "**/serializers/**",
    ],
    reason: "Route, handler or request and response schema",
  },
  {
    id: "infra",
    layer: "config",
    paths: [
      ".github/**",
      ".gitlab-ci.yml",
      "**/Dockerfile*",
      "**/*.Dockerfile",
      "**/docker-compose*.{yml,yaml}",
      "**/*.tf",
      "**/terraform/**",
      "**/cloudformation*.{yml,yaml,json}",
      "**/k8s/**",
      "**/helm/**",
      "**/railway.{json,toml}",
      "**/netlify.toml",
      "**/vercel.json",
      "**/fly.toml",
      "**/Procfile",
      "**/justfile",
      "**/Makefile",
    ],
    reason: "CI, deployment or infrastructure",
  },
  {
    id: "build",
    layer: "config",
    paths: [
      "**/package.json",
      "**/pnpm-lock.yaml",
      "**/pnpm-workspace.yaml",
      "**/package-lock.json",
      "**/yarn.lock",
      "**/bun.lock",
      "**/bun.lockb",
      "**/pyproject.toml",
      "**/uv.lock",
      "**/poetry.lock",
      "**/requirements*.txt",
      "**/Pipfile*",
      "**/go.{mod,sum}",
      "**/Cargo.{toml,lock}",
      "**/Gemfile*",
      "**/tsconfig*.json",
      "**/*.config.{js,cjs,mjs,ts}",
      "**/.env.example",
      "**/.gitattributes",
      "**/.gitignore",
      "**/*.{yml,yaml,toml,ini,cfg}",
    ],
    reason: "Dependency, build or runtime configuration",
  },
  {
    id: "docs",
    layer: "docs",
    paths: ["**/*.{md,mdx,rst,adoc,txt}", "docs/**", "**/LICENSE*"],
    reason: "Documentation",
  },
  {
    id: "ui",
    layer: "ui",
    paths: [
      "**/*.{tsx,jsx,vue,svelte,astro}",
      "**/*.{css,scss,sass,less}",
      "**/*.html",
      "**/components/**",
      "**/pages/**",
      "**/public/**",
    ],
    reason: "Page, component, style or static asset",
  },
];

/** Extensions treated as application code when no rule matches. */
const CODE_EXTENSIONS = new Set(
  "ts mts cts js mjs cjs py go rb rs java kt swift cs php scala ex exs c h cc cpp hpp m sh".split(
    " ",
  ),
);

/**
 * Builds a path classifier. `repoRules` (a repo's own, kept in Strata's data
 * folder) run before the defaults. The reason names the glob that matched.
 */
export function createPathClassifier(
  repoRules: readonly LayerRule[] = [],
  defaults: readonly LayerRule[] = DEFAULT_LAYER_RULES,
): (path: string) => LayerAssignment {
  const compiled = [...repoRules, ...defaults].flatMap((rule) =>
    rule.paths.map((glob) => ({ rule, glob, match: picomatch(glob, { dot: true }) })),
  );
  return (path) => {
    for (const { rule, glob, match } of compiled) {
      if (match(path)) {
        return {
          layer: rule.layer,
          by: "rule",
          reason: `${rule.reason}: matches ${glob}`,
          confidence: "high",
        };
      }
    }
    const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
    if (CODE_EXTENSIONS.has(ext)) {
      return {
        layer: "logic",
        by: "default",
        reason: "No rule matched, so it's taken as application code",
        confidence: "low",
      };
    }
    return { layer: "other", by: "default", reason: "No rule matched", confidence: "low" };
  };
}

/**
 * Server configuration from environment variables, validated once at startup
 * so a misconfigured deploy fails loudly instead of half-working.
 */
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const DEV_SESSION_SECRET = "strata-development-session-secret-not-for-production";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  /** Where people open Strata. In dev this is the Vite server, which proxies to us. */
  PUBLIC_URL: z.url().default("http://localhost:5173"),
  DATA_DIR: z.string().min(1).optional(),
  SESSION_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  /** Comma-separated GitHub logins allowed to sign in. */
  ALLOWED_GITHUB_LOGINS: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  STRATA_MODEL: z.string().min(1).optional(),
  WEB_DIST: z.string().min(1).optional(),
  DEV_AUTH_BYPASS: z.string().optional(),
  DEV_GITHUB_LOGIN: z.string().optional(),
  DEV_GITHUB_TOKEN: z.string().optional(),
  /** A GraphQL endpoint to read PRs from instead of GitHub's, such as the fixture GitHub. */
  DEV_GITHUB_GRAPHQL_URL: z.url().optional(),
  /** Where to fetch repos from instead of github.com; `{repo}` becomes `owner/name`. */
  DEV_GIT_REMOTE: z.string().min(1).optional(),
  /** Where to send Anthropic API requests instead, such as the fixture GitHub's stand-in Claude. */
  DEV_ANTHROPIC_BASE_URL: z.url().optional(),
  /** Local checkouts Strata may borrow objects from: `owner/name=path,owner/name=path`. */
  STRATA_CHECKOUTS: z.string().default(""),
});

export interface DevBypass {
  login: string;
  githubToken: string | null;
}

export interface ServerConfig {
  env: "development" | "test" | "production";
  port: number;
  publicUrl: URL;
  dataDir: string;
  sessionSecret: string;
  github: { clientId: string; clientSecret: string } | null;
  /** Lower-cased. */
  allowedLogins: ReadonlySet<string>;
  anthropicApiKey: string | null;
  model: string | null;
  webDist: string | null;
  /** Local checkouts by `owner/name`, absolute paths. Only ever read. */
  checkouts: Record<string, string>;
  /** Skips GitHub OAuth with a synthetic session. Never set in production. */
  devBypass: DevBypass | null;
  /** Stand-ins for GitHub's API and git host, for driving the app offline. Never set in production. */
  devGitHub: { graphqlUrl: string | null; gitRemote: string | null } | null;
  /** A stand-in for the Anthropic API. Never set in production. */
  devAnthropicBaseUrl: string | null;
  warnings: string[];
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid server configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(
  source: NodeJS.ProcessEnv,
  defaults: { webDist?: string } = {},
): ServerConfig {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const env = parsed.data;
  const production = env.NODE_ENV === "production";
  const problems: string[] = [];
  const warnings: string[] = [];

  // Hard-gated on NODE_ENV, so a production build can never activate it.
  const devBypass: DevBypass | null =
    !production && env.DEV_AUTH_BYPASS === "1"
      ? { login: env.DEV_GITHUB_LOGIN || "dev", githubToken: env.DEV_GITHUB_TOKEN || null }
      : null;
  if (production && env.DEV_AUTH_BYPASS === "1") {
    warnings.push("DEV_AUTH_BYPASS is ignored in production.");
  }
  const wantsDevGitHub = Boolean(env.DEV_GITHUB_GRAPHQL_URL || env.DEV_GIT_REMOTE);
  const devGitHub =
    !production && wantsDevGitHub
      ? { graphqlUrl: env.DEV_GITHUB_GRAPHQL_URL ?? null, gitRemote: env.DEV_GIT_REMOTE ?? null }
      : null;
  if (production && wantsDevGitHub) {
    warnings.push("DEV_GITHUB_GRAPHQL_URL and DEV_GIT_REMOTE are ignored in production.");
  }
  const devAnthropicBaseUrl = production ? null : (env.DEV_ANTHROPIC_BASE_URL ?? null);
  if (production && env.DEV_ANTHROPIC_BASE_URL) {
    warnings.push("DEV_ANTHROPIC_BASE_URL is ignored in production.");
  }

  let sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret.length < 32) {
    if (production) problems.push("SESSION_SECRET must be at least 32 characters in production.");
    else {
      sessionSecret = DEV_SESSION_SECRET;
      warnings.push("SESSION_SECRET is unset or short; using a fixed development secret.");
    }
  }

  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
      : null;
  if (!github && !devBypass) {
    problems.push(
      "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required (or DEV_AUTH_BYPASS=1 in development).",
    );
  }

  const allowedLogins = new Set(
    env.ALLOWED_GITHUB_LOGINS.split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedLogins.size === 0 && !devBypass) {
    problems.push("ALLOWED_GITHUB_LOGINS must list at least one GitHub login.");
  }

  const checkouts = parseCheckouts(env.STRATA_CHECKOUTS, problems);

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    env: env.NODE_ENV,
    port: env.PORT,
    publicUrl: new URL(env.PUBLIC_URL),
    dataDir: path.resolve(env.DATA_DIR ?? (production ? "/data" : ".data")),
    sessionSecret,
    github,
    allowedLogins,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    model: env.STRATA_MODEL ?? null,
    webDist: env.WEB_DIST ? path.resolve(env.WEB_DIST) : (defaults.webDist ?? null),
    checkouts,
    devBypass,
    devGitHub,
    devAnthropicBaseUrl,
    warnings,
  };
}

function parseCheckouts(value: string, problems: string[]): Record<string, string> {
  const checkouts: Record<string, string> = {};
  for (const entry of value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const match = /^([\w.-]+\/[\w.-]+)=(.+)$/.exec(entry);
    if (!match) {
      problems.push(`STRATA_CHECKOUTS: "${entry}" should look like owner/name=/path/to/checkout.`);
      continue;
    }
    const [, repo, raw] = match as unknown as [string, string, string];
    const expanded =
      raw === "~" || raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(1)) : raw;
    if (!path.isAbsolute(expanded)) {
      problems.push(`STRATA_CHECKOUTS: the path for ${repo} must be absolute or start with ~/.`);
      continue;
    }
    checkouts[repo] = path.normalize(expanded);
  }
  return checkouts;
}

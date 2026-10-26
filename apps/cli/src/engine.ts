/**
 * The engine as the CLI and its scripts make it. GITHUB_TOKEN and
 * ANTHROPIC_API_KEY come from the environment, as do the server's dev
 * settings for stand-ins: DEV_GITHUB_GRAPHQL_URL, DEV_GIT_REMOTE (with
 * {repo} for owner/name) and DEV_ANTHROPIC_BASE_URL.
 */
import os from "node:os";
import path from "node:path";
import { createEngine, createGitHubPort, type Engine } from "@strata/engine";

export function dataDirOf(dataDir: string | undefined): string {
  return path.resolve(dataDir ?? path.join(os.homedir(), ".strata"));
}

export function cliEngine(
  options: { dataDir: string; checkouts?: Record<string, string> },
  env: NodeJS.ProcessEnv = process.env,
): Engine {
  const token = env.GITHUB_TOKEN;
  const remote = env.DEV_GIT_REMOTE;
  return createEngine({
    dataDir: options.dataDir,
    ...(token ? { githubToken: token } : {}),
    ...(token && env.DEV_GITHUB_GRAPHQL_URL
      ? { githubPort: createGitHubPort({ token, endpoint: env.DEV_GITHUB_GRAPHQL_URL }) }
      : {}),
    ...(remote ? { gitRemote: (repo: string) => remote.replaceAll("{repo}", repo) } : {}),
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.DEV_ANTHROPIC_BASE_URL ? { anthropicBaseUrl: env.DEV_ANTHROPIC_BASE_URL } : {}),
    ...(options.checkouts ? { checkouts: options.checkouts } : {}),
    log: (message) => console.error(message),
  });
}

/**
 * GitHub sign-in through Arctic. Only logins on ALLOWED_GITHUB_LOGINS get a
 * session. The OAuth token is kept (encrypted) because Strata reads PRs and
 * clones private repos on the user's behalf.
 */
import { GitHub } from "arctic";
import type { ServerConfig } from "../config.js";

/** `repo` to read private PRs and clone; `read:user` for the profile. */
export const GITHUB_SCOPES = ["repo", "read:user"];

export interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/** The two network calls sign-in makes, behind an interface so tests can fake them. */
export interface GitHubOAuth {
  authorizationUrl(state: string): URL;
  exchangeCode(code: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<GitHubProfile>;
}

export function createGitHubOAuth(config: ServerConfig): GitHubOAuth | null {
  if (!config.github) return null;
  const redirect = new URL("/auth/callback", config.publicUrl).toString();
  const github = new GitHub(config.github.clientId, config.github.clientSecret, redirect);
  return {
    authorizationUrl: (state) => github.createAuthorizationURL(state, GITHUB_SCOPES),
    exchangeCode: async (code) => (await github.validateAuthorizationCode(code)).accessToken(),
    async fetchProfile(accessToken) {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "strata",
        },
      });
      if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`);
      const body = (await res.json()) as {
        id: number;
        login: string;
        name: string | null;
        avatar_url: string | null;
      };
      return { id: body.id, login: body.login, name: body.name, avatarUrl: body.avatar_url };
    },
  };
}

export function isAllowed(config: ServerConfig, login: string): boolean {
  return config.allowedLogins.has(login.toLowerCase());
}

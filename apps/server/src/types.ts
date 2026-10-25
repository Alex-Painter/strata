import type { GitHubOAuth } from "./auth/github.js";
import type { ServerConfig } from "./config.js";
import type { Db } from "./db/client.js";

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AppEnv {
  Variables: { user: SessionUser };
}

export interface AppDeps {
  config: ServerConfig;
  db: Db;
  /** Null when GitHub OAuth isn't configured (dev bypass only). */
  oauth: GitHubOAuth | null;
}

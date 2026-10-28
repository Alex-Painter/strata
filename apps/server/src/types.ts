import type { Engine } from "@strata/engine";
import type { AssignedSearch } from "./assigned.js";
import type { GitHubOAuth } from "./auth/github.js";
import type { ServerConfig } from "./config.js";
import type { Db } from "./db/client.js";
import type { Jobs } from "./jobs.js";
import type { RunQueue } from "./runs.js";

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
  /** The engine that reads GitHub as this user. */
  engineFor: (userId: string) => Engine;
  runs: RunQueue;
  /** Finds the Changes GitHub lists for the user. */
  assigned: AssignedSearch;
  /** For slow requests (the first read of a repo); tests pass a short wait. */
  jobs?: Jobs;
}

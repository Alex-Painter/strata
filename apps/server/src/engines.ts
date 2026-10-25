/**
 * One engine per GitHub token, so each user's runs read GitHub as that user.
 * The dev bypass uses DEV_GITHUB_TOKEN; signed-in users use the token they
 * granted at sign-in, stored encrypted.
 */
import { createEngine, type Engine, type EngineConfig } from "@strata/engine";
import { eq } from "drizzle-orm";
import { createTokenCipher, hashToken } from "./auth/crypto.js";
import type { ServerConfig } from "./config.js";
import type { Db } from "./db/client.js";
import { users } from "./db/schema.js";

export function engineFactory(
  config: ServerConfig,
  db: Db,
  /** Settings tests replace, such as a fake GitHub. */
  overrides: Partial<EngineConfig> = {},
): (userId: string) => Engine {
  const cipher = createTokenCipher(config.sessionSecret);
  const engines = new Map<string, Engine>();

  const tokenFor = (userId: string): string | undefined => {
    if (config.devBypass) return config.devBypass.githubToken ?? undefined;
    const user = db.select().from(users).where(eq(users.id, userId)).get();
    return user?.githubTokenEnc ? cipher.decrypt(user.githubTokenEnc) : undefined;
  };

  return (userId) => {
    const token = tokenFor(userId);
    const key = token ? hashToken(token) : "none";
    let engine = engines.get(key);
    if (!engine) {
      engine = createEngine({
        dataDir: config.dataDir,
        ...(token ? { githubToken: token } : {}),
        ...(config.anthropicApiKey ? { anthropicApiKey: config.anthropicApiKey } : {}),
        ...(config.model ? { model: config.model } : {}),
        checkouts: config.checkouts,
        log: (message) => console.log(`[strata] ${message}`),
        ...overrides,
      });
      engines.set(key, engine);
    }
    return engine;
  };
}

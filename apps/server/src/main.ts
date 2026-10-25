import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createGitHubOAuth } from "./auth/github.js";
import { ConfigError, loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { engineFactory } from "./engines.js";
import { RunQueue } from "./runs.js";

// Both src/main.ts (tsx) and dist/main.js (bundle) sit one level below
// apps/server, so these resolve the same way in dev and production.
const fromHere = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env, { webDist: fromHere("../../web/dist") });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`[strata] ${error.message}`);
    process.exit(1);
  }
  throw error;
}
for (const warning of config.warnings) console.warn(`[strata] Warning: ${warning}`);

const { db, close } = openDatabase(
  path.join(config.dataDir, "strata.sqlite"),
  fromHere("../drizzle"),
);
const engineFor = engineFactory(config, db);
const app = createApp({
  config,
  db,
  oauth: createGitHubOAuth(config),
  engineFor,
  runs: new RunQueue(db, engineFor),
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  const signIn = config.devBypass ? `dev bypass as ${config.devBypass.login}` : "GitHub";
  const web =
    config.webDist && existsSync(config.webDist) ? config.webDist : "not built (API only)";
  console.log(
    `[strata] Listening on :${info.port} | public URL ${config.publicUrl.origin} | data ${config.dataDir} | ` +
      `sign-in ${signIn} | LLM ${config.anthropicApiKey ? "on" : "off"} | web ${web}`,
  );
});

function shutdown(signal: string) {
  console.log(`[strata] ${signal} received, shutting down.`);
  server.close(() => {
    close();
    process.exit(0);
  });
  // Don't hang a deploy on a stuck connection.
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

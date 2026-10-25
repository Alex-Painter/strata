import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { authRoutes } from "./auth/routes.js";
import { apiRoutes } from "./routes/api.js";
import type { AppDeps, AppEnv } from "./types.js";

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders());
  // Rejects cross-site form posts. JSON requests can't be sent cross-site
  // without a CORS preflight, which this server never grants.
  app.use("*", csrf({ origin: deps.config.publicUrl.origin }));

  app.get("/healthz", (c) => {
    deps.db.run(sql`select 1`);
    return c.json({ ok: true });
  });

  app.route("/auth", authRoutes(deps));
  app.route("/api", apiRoutes(deps));

  const webDist = deps.config.webDist;
  const indexFile = webDist ? path.join(webDist, "index.html") : null;
  if (webDist && indexFile && existsSync(indexFile)) {
    const indexHtml = readFileSync(indexFile, "utf8");
    // Vite fingerprints everything under /assets, so it can be cached forever.
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    // "/" and other directory URLs skip the file server so they get the app
    // shell below, with no-cache, instead of a cached copy of index.html.
    const files = serveStatic({ root: webDist });
    app.use("*", (c, next) => (c.req.path.endsWith("/") ? next() : files(c, next)));
    // Client-side routes all load the app shell.
    app.get("*", (c) => {
      if (c.req.path.startsWith("/auth/")) return c.notFound();
      c.header("Cache-Control", "no-cache");
      return c.html(indexHtml);
    });
  }

  app.notFound((c) => c.json({ error: "Not found." }, 404));
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error("[strata] Unhandled error:", error);
    return c.json({ error: "Internal server error." }, 500);
  });

  return app;
}

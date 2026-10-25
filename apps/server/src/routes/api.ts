/**
 * The JSON API. Types come from @strata/core's model/api.ts and model/chat.ts
 * so the web app and the server can't drift apart.
 *
 * /api/me, the stack list and the Changes routes are live (routes/changes.ts).
 * The rest are declared with their final paths and answer 501, so the web app
 * can be wired against them and later slices fill them in.
 */
import type { MeResponse } from "@strata/core/model";
import type { Context } from "hono";
import { Hono } from "hono";
import { requireUser } from "../auth/routes.js";
import type { AppDeps, AppEnv } from "../types.js";
import { changeRoutes } from "./changes.js";

export function apiRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser(deps));

  app.get("/me", (c) => {
    const user = c.get("user");
    return c.json<MeResponse>({ login: user.login, name: user.name, avatarUrl: user.avatarUrl });
  });

  app.route("/", changeRoutes(deps));

  const notYet = (c: Context) => c.json({ error: "Not implemented yet (milestone 1)." }, 501);
  // Context sources: spec, ticket, design, notes.
  app.post("/changes/:id/sources", notYet);
  app.delete("/changes/:id/sources/:sourceId", notYet);
  // Whole files at the Change's base or head, for the workspace's file panes.
  app.get("/changes/:id/files", notYet);
  // Chat about a Change. Posting a message answers with a text/event-stream
  // of ChatStreamEvent (status, delta, done, error).
  app.get("/changes/:id/threads", notYet);
  app.post("/changes/:id/threads", notYet);
  app.get("/threads/:id/messages", notYet);
  app.post("/threads/:id/messages", notYet);

  // A mounted sub-app's notFound never fires, so without this route the
  // parent's app-shell fallback would answer unknown API paths with HTML.
  app.all("*", (c) => c.json({ error: "Not found." }, 404));
  return app;
}

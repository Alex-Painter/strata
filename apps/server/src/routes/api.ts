/**
 * The JSON API. Types come from @strata/core's model/api.ts and model/chat.ts
 * so the web app and the server can't drift apart.
 *
 * In the scaffold only /api/me is live. The rest are declared with their
 * final paths and answer 501, so the web app can be wired against them and
 * milestone 1 fills in one handler at a time.
 */
import type { MeResponse } from "@strata/core/model";
import type { Context } from "hono";
import { Hono } from "hono";
import { requireUser } from "../auth/routes.js";
import type { AppDeps, AppEnv } from "../types.js";

export function apiRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser(deps));

  app.get("/me", (c) => {
    const user = c.get("user");
    return c.json<MeResponse>({ login: user.login, name: user.name, avatarUrl: user.avatarUrl });
  });

  const notYet = (c: Context) => c.json({ error: "Not implemented yet (milestone 1)." }, 501);

  // Changes and analysis runs.
  app.get("/changes", notYet);
  app.post("/changes", notYet);
  app.get("/changes/:id", notYet);
  app.post("/changes/:id/runs", notYet);
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

  app.notFound((c) => c.json({ error: "Not found." }, 404));
  return app;
}

/**
 * The JSON API. Types come from @strata/core's model/api.ts and model/chat.ts
 * so the web app and the server can't drift apart.
 *
 * /api/me, the assignment search, the stack list and the Changes routes are live (routes/changes.ts).
 * The rest are declared with their final paths and answer 501, so the web app
 * can be wired against them and later slices fill them in.
 */
import type { AssignedStatus, MeResponse, RepoSettingsResponse } from "@strata/core/model";
import { loadRepoSettings, SettingsError, saveSendCodeToAnthropic } from "@strata/engine";
import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
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

  // The assignment search runs on a timer; this asks for one now.
  app.get("/assigned", (c) => c.json<AssignedStatus>(deps.assigned.status(c.get("user").id)));
  app.post("/assigned/search", (c) => {
    const userId = c.get("user").id;
    void deps.assigned.search(userId);
    return c.json<AssignedStatus>(deps.assigned.status(userId), 202);
  });

  // Per-repo settings live in <dataDir>/settings/<owner>/<name>.json.
  app.get("/repos/:owner/:name/settings", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const settings = await loadRepoSettings(deps.config.dataDir, repo).catch(badFile);
    return c.json<RepoSettingsResponse>(settingsBody(repo, settings.sendCodeToAnthropic));
  });
  app.post("/repos/:owner/:name/settings", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const body = (await c.req.json().catch(() => null)) as { sendCodeToAnthropic?: unknown } | null;
    if (typeof body?.sendCodeToAnthropic !== "boolean") {
      return c.json({ error: "Send { sendCodeToAnthropic: true or false }." }, 400);
    }
    const settings = await saveSendCodeToAnthropic(
      deps.config.dataDir,
      repo,
      body.sendCodeToAnthropic,
    ).catch(badFile);
    return c.json<RepoSettingsResponse>(settingsBody(repo, settings.sendCodeToAnthropic));
  });
  // A settings file a person broke by hand: say what is wrong with it.
  const badFile = (error: unknown): never => {
    if (error instanceof SettingsError) {
      throw new HTTPException(422, {
        res: Response.json({ error: error.message }, { status: 422 }),
      });
    }
    throw error;
  };
  const settingsBody = (repo: string, send: boolean): RepoSettingsResponse => ({
    repo,
    sendCodeToAnthropic: send,
    claudeAvailable: Boolean(deps.config.anthropicApiKey),
  });

  app.route("/", changeRoutes(deps));

  const notYet = (c: Context) =>
    c.json({ error: "Not available at this time (milestone 1)." }, 501);
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

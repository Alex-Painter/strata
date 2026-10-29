import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { AssignedSearch } from "./assigned.js";
import type { GitHubOAuth } from "./auth/github.js";
import { SESSION_TTL_MS } from "./auth/session.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { engineFactory } from "./engines.js";
import { RunQueue } from "./runs.js";

const migrations = fileURLToPath(new URL("../drizzle", import.meta.url));
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

const fakeOAuth: GitHubOAuth = {
  authorizationUrl: (state) => new URL(`https://github.com/login/oauth/authorize?state=${state}`),
  exchangeCode: async (code) => `token-for-${code}`,
  fetchProfile: async (token) =>
    token === "token-for-stranger"
      ? { id: 2, login: "stranger", name: null, avatarUrl: null }
      : { id: 1, login: "Alex-Painter", name: "Alex", avatarUrl: "https://avatars.example/1" },
};

function setup(env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    PUBLIC_URL: "http://localhost:5173",
    GITHUB_CLIENT_ID: "id",
    GITHUB_CLIENT_SECRET: "secret",
    ALLOWED_GITHUB_LOGINS: "alex-painter",
    ...env,
  });
  const { db, close } = openDatabase(":memory:", migrations);
  closers.push(close);
  const engineFor = engineFactory(config, db);
  const runs = new RunQueue(db, engineFor);
  return {
    app: createApp({
      config,
      db,
      oauth: fakeOAuth,
      engineFor,
      runs,
      assigned: new AssignedSearch(db, engineFor, runs, config.assignedRepos),
    }),
    config,
  };
}

function cookieValue(res: Response, name: string): string | undefined {
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return header?.split(";")[0]?.slice(name.length + 1);
}

async function signIn(app: ReturnType<typeof setup>["app"], code = "ok") {
  const login = await app.request("/auth/login");
  const state = cookieValue(login, "strata_oauth_state");
  return app.request(`/auth/callback?state=${state}&code=${code}`, {
    headers: { Cookie: `strata_oauth_state=${state}` },
  });
}

describe("health", () => {
  it("answers without a session", async () => {
    const res = await setup().app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GitHub sign-in", () => {
  it("redirects to GitHub with a state cookie", async () => {
    const res = await setup().app.request("/auth/login");
    expect(res.status).toBe(302);
    const state = cookieValue(res, "strata_oauth_state");
    expect(state).toBeTruthy();
    expect(res.headers.get("location")).toContain(`state=${state}`);
  });

  it("signs in an allowed user and serves /api/me", async () => {
    const { app } = setup();
    const callback = await signIn(app);
    expect(callback.headers.get("location")).toBe("/");
    const session = cookieValue(callback, "strata_session");
    expect(session).toBeTruthy();

    const me = await app.request("/api/me", { headers: { Cookie: `strata_session=${session}` } });
    expect(await me.json()).toEqual({
      login: "Alex-Painter",
      name: "Alex",
      avatarUrl: "https://avatars.example/1",
    });
  });

  it("refuses logins that are not on the allowlist", async () => {
    const res = await signIn(setup().app, "stranger");
    expect(res.headers.get("location")).toBe("/?auth_error=not_allowed");
    expect(cookieValue(res, "strata_session")).toBeUndefined();
  });

  it("refuses a callback whose state doesn't match", async () => {
    const res = await setup().app.request("/auth/callback?state=forged&code=ok", {
      headers: { Cookie: "strata_oauth_state=real" },
    });
    expect(res.headers.get("location")).toBe("/?auth_error=invalid_state");
  });

  it("signs out", async () => {
    const { app } = setup();
    const session = cookieValue(await signIn(app), "strata_session");
    const cookie = { Cookie: `strata_session=${session}` };
    const out = await app.request("/auth/logout", {
      method: "POST",
      headers: { ...cookie, Origin: "http://localhost:5173", "Content-Type": "application/json" },
    });
    expect(out.status).toBe(204);
    expect((await app.request("/api/me", { headers: cookie })).status).toBe(401);
  });

  it("expires sessions", async () => {
    const { app } = setup();
    const session = cookieValue(await signIn(app), "strata_session");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + SESSION_TTL_MS + 1000);
      const res = await app.request("/api/me", {
        headers: { Cookie: `strata_session=${session}` },
      });
      expect(res.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects cross-site form posts", async () => {
    const res = await setup().app.request("/auth/logout", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    expect(res.status).toBe(403);
  });
});

describe("/api", () => {
  it("requires a session", async () => {
    const res = await setup().app.request("/api/me");
    expect(res.status).toBe(401);
  });

  it("uses the dev bypass when enabled", async () => {
    const { app } = setup({ DEV_AUTH_BYPASS: "1", DEV_GITHUB_LOGIN: "alex" });
    const me = await app.request("/api/me");
    expect(await me.json()).toMatchObject({ login: "alex" });
  });

  it("declares milestone-1 routes as not implemented", async () => {
    const { app } = setup({ DEV_AUTH_BYPASS: "1" });
    expect((await app.request("/api/changes/chg_1/files")).status).toBe(501);
    expect((await app.request("/api/nope")).status).toBe(404);
  });
});

describe("web app", () => {
  it("serves the built app shell for client-side routes", async () => {
    const dist = mkdtempSync(path.join(os.tmpdir(), "strata-web-"));
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Strata</title>");
    writeFileSync(path.join(dist, "assets", "app.js"), "console.log(1)");
    const { app } = setup({ WEB_DIST: dist });

    for (const url of ["/", "/changes/chg_123"]) {
      const shell = await app.request(url);
      expect(shell.headers.get("content-type")).toContain("text/html");
      expect(shell.headers.get("cache-control")).toBe("no-cache");
      expect(await shell.text()).toContain("<title>Strata</title>");
    }

    const asset = await app.request("/assets/app.js");
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await app.request("/api/unknown")).status).toBe(401);
  });

  it("answers unknown API paths with JSON, not the app shell", async () => {
    const dist = mkdtempSync(path.join(os.tmpdir(), "strata-web-"));
    writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>Strata</title>");
    const { app } = setup({ WEB_DIST: dist, DEV_AUTH_BYPASS: "1" });

    const res = await app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Not found." });
  });
});

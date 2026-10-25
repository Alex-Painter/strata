import { timingSafeEqual } from "node:crypto";
import { generateState } from "arctic";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { users } from "../db/schema.js";
import type { AppDeps, AppEnv, SessionUser } from "../types.js";
import { createTokenCipher, newId } from "./crypto.js";
import { isAllowed } from "./github.js";
import {
  clearSessionCookie,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findSessionUser,
  isSecure,
  readSessionCookie,
  writeSessionCookie,
} from "./session.js";

const STATE_COOKIE = "strata_oauth_state";

/** Why sign-in failed, as shown by the web app's sign-in screen. */
export type AuthError = "invalid_state" | "github_error" | "not_allowed";

export function authRoutes({ config, db, oauth }: AppDeps) {
  const cipher = createTokenCipher(config.sessionSecret);
  const app = new Hono<AppEnv>();
  const fail = (c: Context, error: AuthError) => c.redirect(`/?auth_error=${error}`);

  app.get("/login", (c) => {
    if (config.devBypass) return c.redirect("/");
    if (!oauth) return c.json({ error: "GitHub sign-in is not configured." }, 503);
    const state = generateState();
    setCookie(c, STATE_COOKIE, state, {
      path: "/auth",
      httpOnly: true,
      secure: isSecure(config),
      sameSite: "Lax",
      maxAge: 10 * 60,
    });
    return c.redirect(oauth.authorizationUrl(state).toString());
  });

  app.get("/callback", async (c) => {
    if (!oauth) return c.json({ error: "GitHub sign-in is not configured." }, 503);
    const expected = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: "/auth" });
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!expected || !state || !code || !sameString(expected, state))
      return fail(c, "invalid_state");

    let accessToken: string;
    let profile: Awaited<ReturnType<typeof oauth.fetchProfile>>;
    try {
      accessToken = await oauth.exchangeCode(code);
      profile = await oauth.fetchProfile(accessToken);
    } catch (error) {
      console.warn(
        `[strata] GitHub sign-in failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return fail(c, "github_error");
    }
    if (!isAllowed(config, profile.login)) {
      console.warn(`[strata] Refused sign-in for ${profile.login}: not on ALLOWED_GITHUB_LOGINS.`);
      return fail(c, "not_allowed");
    }

    const now = new Date();
    const existing = db.select().from(users).where(eq(users.githubId, profile.id)).get();
    const fields = {
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      githubTokenEnc: cipher.encrypt(accessToken),
      updatedAt: now,
    };
    const userId = existing?.id ?? newId("usr");
    if (existing) db.update(users).set(fields).where(eq(users.id, userId)).run();
    else
      db.insert(users)
        .values({ id: userId, githubId: profile.id, createdAt: now, ...fields })
        .run();

    deleteExpiredSessions(db, userId, now);
    const session = createSession(db, userId, now);
    writeSessionCookie(c, config, session.token, session.expiresAt);
    return c.redirect("/");
  });

  app.post("/logout", (c) => {
    const token = readSessionCookie(c, config);
    if (token) deleteSession(db, token);
    clearSessionCookie(c, config);
    return c.body(null, 204);
  });

  return app;
}

/** Loads the signed-in user for /api routes, or answers 401. */
export function requireUser({ config, db }: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let user: SessionUser | null = null;
    if (config.devBypass) {
      user = {
        id: "usr_dev",
        login: config.devBypass.login,
        name: config.devBypass.login,
        avatarUrl: null,
      };
    } else {
      const token = readSessionCookie(c, config);
      const found = token ? findSessionUser(db, token) : null;
      if (found)
        user = { id: found.id, login: found.login, name: found.name, avatarUrl: found.avatarUrl };
    }
    if (!user) return c.json({ error: "Sign in required." }, 401);
    c.set("user", user);
    await next();
  };
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

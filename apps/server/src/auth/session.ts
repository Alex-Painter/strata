/**
 * Cookie sessions. The cookie holds a random token; the database holds its
 * hash, the user and an expiry. Thirty days, no sliding renewal: signing in
 * again is cheap and keeps the GitHub token fresh.
 */
import { and, eq, lt } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ServerConfig } from "../config.js";
import type { Db } from "../db/client.js";
import { sessions, type User, users } from "../db/schema.js";
import { hashToken, newSessionToken } from "./crypto.js";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** `__Host-` pins the cookie to this exact origin; browsers only allow it over https. */
export function sessionCookieName(config: ServerConfig): string {
  return isSecure(config) ? "__Host-strata_session" : "strata_session";
}

export function isSecure(config: ServerConfig): boolean {
  return config.publicUrl.protocol === "https:";
}

export function createSession(
  db: Db,
  userId: string,
  now = new Date(),
): { token: string; expiresAt: Date } {
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.insert(sessions)
    .values({ id: hashToken(token), userId, expiresAt, createdAt: now })
    .run();
  return { token, expiresAt };
}

export function findSessionUser(db: Db, token: string, now = new Date()): User | null {
  const row = db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, hashToken(token)))
    .get();
  if (!row) return null;
  if (row.expiresAt <= now) {
    db.delete(sessions)
      .where(eq(sessions.id, hashToken(token)))
      .run();
    return null;
  }
  return row.user;
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions)
    .where(eq(sessions.id, hashToken(token)))
    .run();
}

export function deleteExpiredSessions(db: Db, userId: string, now = new Date()): void {
  db.delete(sessions)
    .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now)))
    .run();
}

export function readSessionCookie(c: Context, config: ServerConfig): string | undefined {
  return getCookie(c, sessionCookieName(config));
}

export function writeSessionCookie(
  c: Context,
  config: ServerConfig,
  token: string,
  expiresAt: Date,
): void {
  setCookie(c, sessionCookieName(config), token, {
    path: "/",
    httpOnly: true,
    secure: isSecure(config),
    sameSite: "Lax",
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context, config: ServerConfig): void {
  deleteCookie(c, sessionCookieName(config), { path: "/", secure: isSecure(config) });
}

/**
 * Comments in a PR's pending review. Ask drafts them; the reviewer edits or
 * removes them here, and sends them with the review (see approvals.ts).
 * Nothing in this file writes to GitHub.
 *
 * GET    /changes/:id/comments  every comment of the Change, pending and posted
 * PATCH  /comments/:id          { body } for a pending comment
 * DELETE /comments/:id          a pending comment
 */
import type { ReviewComment } from "@strata/core/model";
import { and, asc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { changes, type PrCommentRow, prComments } from "../db/schema.js";
import type { AppDeps, AppEnv } from "../types.js";

/** Characters of one comment. */
export const COMMENT_CHARS = 8_000;

export function reviewRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono<AppEnv>();

  app.get("/changes/:id/comments", (c) => {
    const user = c.get("user");
    const change = db
      .select()
      .from(changes)
      .where(and(eq(changes.id, c.req.param("id")), eq(changes.ownerId, user.id)))
      .get();
    if (!change) return c.json({ error: "Not found." }, 404);
    const rows = db
      .select()
      .from(prComments)
      .where(and(eq(prComments.changeId, change.id), eq(prComments.ownerId, user.id)))
      .orderBy(asc(prComments.createdAt), asc(prComments.id))
      .all();
    return c.json<ReviewComment[]>(rows.map(commentOf));
  });

  app.patch("/comments/:id", async (c) => {
    const row = pendingComment(c);
    if ("error" in row) return c.json({ error: row.error }, row.status);
    const body = (await c.req.json().catch(() => null)) as { body?: unknown } | null;
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!text) return c.json({ error: "Write a comment, or remove it." }, 400);
    if (text.length > COMMENT_CHARS) {
      return c.json({ error: `Write a comment of ${COMMENT_CHARS} characters or fewer.` }, 400);
    }
    db.update(prComments).set({ body: text }).where(eq(prComments.id, row.id)).run();
    return c.json<ReviewComment>(commentOf({ ...row, body: text }));
  });

  app.delete("/comments/:id", (c) => {
    const row = pendingComment(c);
    if ("error" in row) return c.json({ error: row.error }, row.status);
    db.delete(prComments).where(eq(prComments.id, row.id)).run();
    return c.body(null, 204);
  });

  function pendingComment(c: Context<AppEnv>): PrCommentRow | { error: string; status: 404 | 409 } {
    const row = db
      .select()
      .from(prComments)
      .where(
        and(
          eq(prComments.id, c.req.param("id") as string),
          eq(prComments.ownerId, c.get("user").id),
        ),
      )
      .get();
    if (!row) return { error: "Not found.", status: 404 };
    if (row.state !== "pending")
      return { error: "This comment is already on GitHub.", status: 409 };
    return row;
  }

  return app;
}

export function commentOf(row: PrCommentRow): ReviewComment {
  return {
    id: row.id,
    changeId: row.changeId,
    pr: row.pr,
    path: row.path,
    line: row.line,
    side: row.side,
    body: row.body,
    messageId: row.messageId,
    commitOid: row.commitOid,
    state: row.state,
    url: row.url,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The database schema: who can sign in, their Changes, analysis runs and the
 * reports runs produce. Context sources and chat threads come later.
 * Change a table here, then run `pnpm --filter @strata/server db:generate` and
 * commit the migration it writes to apps/server/drizzle.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  githubId: integer("github_id").notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  /** The user's GitHub OAuth token, AES-256-GCM encrypted (see auth/crypto.ts). */
  githubTokenEnc: text("github_token_enc"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the session token. The token itself only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * A Change is one path through a stack: a bottom PR and a tip PR. Each user
 * has at most one Change per path, so asking again finds the same one.
 */
export const changes = sqliteTable(
  "changes",
  {
    id: text("id").primaryKey(),
    /** The user who added it. Not a foreign key: the dev bypass user has no row. */
    ownerId: text("owner_id").notNull(),
    /** `owner/name`. */
    repo: text("repo").notNull(),
    rootPr: integer("root_pr").notNull(),
    tipPr: integer("tip_pr").notNull(),
    /** What the user typed, as `describeInput` writes it. */
    input: text("input").notNull(),
    title: text("title").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("changes_path_idx").on(table.ownerId, table.repo, table.rootPr, table.tipPr),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    changeId: text("change_id")
      .notNull()
      .references(() => changes.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["queued", "running", "done", "failed"] }).notNull(),
    progress: text("progress"),
    error: text("error"),
    queuedAt: integer("queued_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("runs_change_id_idx").on(table.changeId)],
);

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    changeId: text("change_id")
      .notNull()
      .references(() => changes.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull(),
    /** The ChangeReport as JSON. */
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("reports_change_id_idx").on(table.changeId)],
);

export type User = typeof users.$inferSelect;
export type ChangeRow = typeof changes.$inferSelect;
export type RunRow = typeof runs.$inferSelect;

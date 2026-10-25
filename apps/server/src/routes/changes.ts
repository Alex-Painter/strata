/**
 * Changes, their runs, and the stack list for a repo.
 *
 * Creating a Change resolves the stack first, because a Change is one path
 * through it (bottom PR to tip PR): asking for any PR on a path you already
 * have returns that Change, and a fork's other path is a separate Change.
 */

import { byRecentActivity, REPORT_SCHEMA_VERSION, StackError, summarizeStack } from "@strata/core";
import {
  type ChangeDetail,
  ChangeInputError,
  type ChangeReport,
  type ChangeSummary,
  describeInput,
  describeRepo,
  parseChangeInput,
  type StacksResponse,
} from "@strata/core/model";
import { GitHubError, NotImplementedError, StackInputError } from "@strata/engine";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { newId } from "../auth/crypto.js";
import { type ChangeRow, changes, reports } from "../db/schema.js";
import { latestRun, runInfo } from "../runs.js";
import type { AppDeps, AppEnv } from "../types.js";

const CreateChange = z.object({
  input: z.string().min(1).max(500),
  leaf: z.number().int().positive().optional(),
  sources: z.array(z.unknown()).optional(),
});

export function changeRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = new Hono<AppEnv>();

  app.get("/repos/:owner/:name/stacks", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const engine = deps.engineFor(c.get("user").id);
    const stacks = await engine.discoverStacks(repo, c.req.raw.signal);
    return c.json<StacksResponse>({
      repo,
      stacks: stacks.map(summarizeStack).sort(byRecentActivity),
    });
  });

  app.get("/changes", (c) => {
    const rows = db
      .select()
      .from(changes)
      .where(eq(changes.ownerId, c.get("user").id))
      .orderBy(desc(changes.updatedAt))
      .all();
    return c.json<ChangeSummary[]>(rows.map((row) => summary(row)));
  });

  app.post("/changes", async (c) => {
    const parsed = CreateChange.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Expected { input, leaf? }." }, 400);
    const { input: raw, leaf, sources } = parsed.data;
    if (sources?.length) return c.json({ error: "Context sources aren't supported yet." }, 501);

    let input = parseChangeInput(raw);
    if (input.kind === "range")
      return c.json({ error: "Commit ranges aren't supported yet." }, 501);
    if (leaf !== undefined) {
      if (input.kind !== "stack-of")
        return c.json({ error: "leaf only applies to one PR or branch." }, 400);
      input = { ...input, seed: { ...input.seed, leaf } };
    }

    const user = c.get("user");
    const resolved = await deps.engineFor(user.id).resolveChange(input, c.req.raw.signal);
    const path = resolved.stack?.selectedPath ?? [];
    const rootPr = path[0];
    const tipPr = path[path.length - 1];
    if (rootPr === undefined || tipPr === undefined)
      throw new Error("A stack came back with no PRs.");
    const repo = describeRepo(input.repo);
    const now = new Date();

    const existing = db
      .select()
      .from(changes)
      .where(
        and(
          eq(changes.ownerId, user.id),
          eq(changes.repo, repo),
          eq(changes.rootPr, rootPr),
          eq(changes.tipPr, tipPr),
        ),
      )
      .get();
    const row: ChangeRow = existing
      ? { ...existing, title: resolved.title, updatedAt: now }
      : {
          id: newId("chg"),
          ownerId: user.id,
          repo,
          rootPr,
          tipPr,
          input: describeInput(input),
          title: resolved.title,
          createdAt: now,
          updatedAt: now,
        };
    if (existing) {
      db.update(changes)
        .set({ title: row.title, updatedAt: now })
        .where(eq(changes.id, row.id))
        .run();
    } else {
      db.insert(changes).values(row).run();
    }
    deps.runs.enqueue(row);
    return c.json<ChangeDetail>(detail(row), existing ? 200 : 201);
  });

  app.get("/changes/:id", (c) => {
    const row = owned(c);
    return row ? c.json<ChangeDetail>(detail(row)) : c.json({ error: "Not found." }, 404);
  });

  app.post("/changes/:id/runs", (c) => {
    const row = owned(c);
    if (!row) return c.json({ error: "Not found." }, 404);
    return c.json(deps.runs.enqueue(row), 202);
  });

  app.onError((error, c) => {
    if (
      error instanceof ChangeInputError ||
      error instanceof StackError ||
      error instanceof StackInputError
    ) {
      return c.json({ error: error.message }, 400);
    }
    if (error instanceof NotImplementedError) return c.json({ error: error.message }, 501);
    if (error instanceof GitHubError) return c.json({ error: error.message }, 502);
    throw error;
  });

  function owned(c: Context<AppEnv>): ChangeRow | undefined {
    return db
      .select()
      .from(changes)
      .where(
        and(eq(changes.id, c.req.param("id") as string), eq(changes.ownerId, c.get("user").id)),
      )
      .get();
  }

  function summary(row: ChangeRow): ChangeSummary {
    return {
      id: row.id,
      title: row.title,
      repo: row.repo,
      input: row.input,
      status: latestRun(db, row.id)?.status ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  function detail(row: ChangeRow): ChangeDetail {
    const run = latestRun(db, row.id);
    // Reports from an older schema are left out; the next run replaces them.
    const report = db
      .select()
      .from(reports)
      .where(and(eq(reports.changeId, row.id), eq(reports.schemaVersion, REPORT_SCHEMA_VERSION)))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .get();
    return {
      change: summary(row),
      run: run ? runInfo(run) : null,
      report: report ? (JSON.parse(report.body) as ChangeReport) : null,
      sources: [],
    };
  }

  return app;
}

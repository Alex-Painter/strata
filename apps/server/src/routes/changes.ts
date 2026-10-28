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
  type PendingResponse,
  parseChangeInput,
  type StacksResponse,
} from "@strata/core/model";
import { GitHubError, NotImplementedError, StackInputError } from "@strata/engine";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { queueRun, saveChange, summarize } from "../change-store.js";
import { type ChangeRow, changes, reports } from "../db/schema.js";
import { Jobs } from "../jobs.js";
import { latestRun, runInfo } from "../runs.js";
import { StackCache } from "../stack-cache.js";
import type { AppDeps, AppEnv } from "../types.js";

const CreateChange = z.object({
  input: z.string().min(1).max(500),
  leaf: z.number().int().positive().optional(),
  sources: z.array(z.unknown()).optional(),
});

export function changeRoutes(deps: AppDeps) {
  const { db } = deps;
  const jobs = deps.jobs ?? new Jobs();
  const stackCache =
    deps.stackCache ??
    new StackCache(deps.config.dataDir, jobs, {
      onError: (error) => console.warn(`[strata] Reading stacks again failed: ${error}`),
    });
  const app = new Hono<AppEnv>();
  const pending = (c: Context<AppEnv>, progress: string | null) =>
    c.json<PendingResponse>({ pending: true, progress }, 202);

  // The first read of a big repo takes minutes, so it runs as a job the client
  // asks after until it's done; the job carries on if the client goes away.
  // After that the last list answers at once, read again behind it when old.
  // Only stacks with an open PR: a busy repo's are mostly merged, and skipping
  // them makes the read many times quicker.
  app.get("/repos/:owner/:name/stacks", async (c) => {
    const repo = `${c.req.param("owner")}/${c.req.param("name")}`;
    const user = c.get("user");
    const found = await stackCache.get(
      { userId: user.id, repo },
      async (onProgress) =>
        (await deps.engineFor(user.id).discoverStacks(repo, { onProgress, open: true }))
          .map(summarizeStack)
          .sort(byRecentActivity),
      c.req.raw.signal,
    );
    if (!found.done) return pending(c, found.progress);
    return c.json<StacksResponse>({
      repo,
      stacks: found.value.stacks,
      readAt: found.value.readAt,
      refreshing: found.refreshing,
    });
  });

  app.get("/changes", (c) => {
    const rows = db
      .select()
      .from(changes)
      .where(eq(changes.ownerId, c.get("user").id))
      .orderBy(desc(changes.updatedAt))
      .all();
    return c.json<ChangeSummary[]>(rows.map((row) => summarize(db, row)));
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
    const found = await jobs.run(
      `resolve\0${user.id}\0${JSON.stringify(input)}`,
      (onProgress) => deps.engineFor(user.id).resolveChange(input, { onProgress }),
      c.req.raw.signal,
    );
    if (!found.done) return pending(c, found.progress);
    // The client gave up while it waited, maybe to ask for something else, so
    // it neither gets nor runs this Change; the job keeps the result in case it
    // asks again. Nobody reads the answer.
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
    const resolved = found.value;
    const { row, created } = saveChange(db, {
      ownerId: user.id,
      input,
      resolved,
      origin: "added",
      now: new Date(),
    });
    queueRun(db, deps.runs, row, resolved);
    return c.json<ChangeDetail>(detail(row), created ? 201 : 200);
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
      change: summarize(db, row),
      run: run ? runInfo(run) : null,
      report: report ? (JSON.parse(report.body) as ChangeReport) : null,
      sources: [],
    };
  }

  return app;
}

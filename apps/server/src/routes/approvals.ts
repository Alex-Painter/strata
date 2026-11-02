/**
 * Approving a Change's PRs on GitHub. This is the one place Strata writes to
 * GitHub, so each approval needs a person's explicit request from Strata's
 * own page, and it names the head commit in the report the person saw.
 *
 * GET  /changes/:id/approvals  what the Approve action can do for each PR on the path
 * POST /changes/:id/approve    { prs: [{ number, headOid }], stack? }
 */
import {
  type ApprovalsResponse,
  type ApproveResponse,
  type ApproveResult,
  approvalBlock,
  approvalState,
  type ChangeReport,
  type PathPr,
  type PrApproval,
  REPORT_SCHEMA_VERSION,
} from "@strata/core/model";
import { GitHubError, type LivePrRead } from "@strata/engine";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { newId } from "../auth/crypto.js";
import { type ChangeRow, changes, prReviews, reports } from "../db/schema.js";
import type { StackCache } from "../stack-cache.js";
import type { AppDeps, AppEnv } from "../types.js";

const Approve = z.object({
  prs: z
    .array(z.object({ number: z.number().int().positive(), headOid: z.string().min(1) }))
    .min(1)
    .max(100),
  stack: z.boolean().optional(),
});

interface PathState {
  row: ChangeRow;
  repo: string;
  /** The path's PRs read from GitHub now, bottom first. */
  reads: LivePrRead[];
  approvals: ApprovalsResponse;
}

export function approvalRoutes(deps: AppDeps, stackCache: StackCache) {
  const { db } = deps;
  const app = new Hono<AppEnv>();

  app.get("/changes/:id/approvals", async (c) => {
    const found = await readPath(c);
    if ("error" in found) return c.json({ error: found.error }, found.status);
    return c.json<ApprovalsResponse>(found.approvals);
  });

  app.post("/changes/:id/approve", async (c) => {
    // A person's click on Strata's own page, never a form or a page on another site.
    if (
      c.req.header("origin") !== deps.config.publicUrl.origin ||
      !c.req.header("content-type")?.startsWith("application/json")
    ) {
      return c.json({ error: "Strata accepts an approval only from its own page." }, 403);
    }
    const parsed = Approve.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "The body must be { prs: [{ number, headOid }], stack? }." }, 400);
    }
    const asked = parsed.data;
    const found = await readPath(c);
    if ("error" in found) return c.json({ error: found.error }, found.status);
    const { row, repo, reads, approvals } = found;
    const byNumber = new Map(approvals.prs.map((pr) => [pr.number, pr]));

    // Check every PR first: Strata sends nothing unless it can send all of them.
    if (asked.stack) {
      const moved = approvals.prs.filter((pr) => pr.state.kind === "head-moved");
      if (moved.length > 0) {
        const list = moved.map((pr) => `#${pr.number}`).join(", ");
        return c.json(
          { error: `${list} has new commits. Run Strata again before you approve the stack.` },
          409,
        );
      }
    }
    for (const { number, headOid } of asked.prs) {
      const pr = byNumber.get(number);
      if (!pr) return c.json({ error: `#${number} is not in this Change.` }, 400);
      if (headOid !== pr.analysedHead) {
        return c.json(
          { error: `The page shows an earlier run of #${number}. Open the page again.` },
          409,
        );
      }
      const block = approvalBlock(pr.state, number);
      if (block) return c.json({ error: block }, 409);
    }

    const engine = deps.engineFor(c.get("user").id);
    const results: ApproveResult[] = [];
    for (const { number } of asked.prs) {
      const pr = byNumber.get(number) as PrApproval;
      const read = reads.find((r) => r.pr.number === number) as LivePrRead;
      const commit = pr.analysedHead as string;
      try {
        const review = await engine.approvePr(read, commit);
        db.insert(prReviews)
          .values({
            id: newId("rev"),
            ownerId: c.get("user").id,
            changeId: row.id,
            repo,
            pr: number,
            login: read.viewer,
            commitOid: review.commitOid,
            url: review.url,
            submittedAt: new Date(),
          })
          .run();
        results.push({ number, ok: true, url: review.url, commitOid: review.commitOid });
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        results.push({
          number,
          ok: false,
          error: `GitHub did not accept the approval of #${number}. ${error.message}`,
        });
      }
    }

    const after = await readPath(c);
    const fresh = "error" in after ? approvals : after.approvals;
    if (results.some((r) => r.ok)) {
      const userId = c.get("user").id;
      keepReviews(userId, repo, fresh);
      // GitHub changed under these lists; read them again, and move the
      // Change out of "Waiting on you" without a wait for the next search.
      stackCache.expire({ userId, repo });
      void deps.assigned.search(userId).catch(() => {});
    }
    return c.json<ApproveResponse>({ results, approvals: fresh });
  });

  app.onError((error, c) => {
    if (error instanceof GitHubError) return c.json({ error: error.message }, 502);
    throw error;
  });

  /** The Change, its latest report's path, and each PR on it as GitHub shows it now. */
  async function readPath(
    c: Context<AppEnv>,
  ): Promise<PathState | { error: string; status: 404 | 409 }> {
    const user = c.get("user");
    const row = db
      .select()
      .from(changes)
      .where(and(eq(changes.id, c.req.param("id") as string), eq(changes.ownerId, user.id)))
      .get();
    if (!row) return { error: "Not found.", status: 404 };
    const saved = db
      .select()
      .from(reports)
      .where(and(eq(reports.changeId, row.id), eq(reports.schemaVersion, REPORT_SCHEMA_VERSION)))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .get();
    const stack = saved ? (JSON.parse(saved.body) as ChangeReport).stack : null;
    if (!stack) {
      return {
        error: "Strata has no report of this Change. Wait for the run to end.",
        status: 409,
      };
    }
    const heads = new Map(stack.nodes.map((node) => [node.pr.number, node.pr.headOid]));
    const engine = deps.engineFor(user.id);
    const reads = await Promise.all(
      stack.selectedPath.map((number) => engine.readPr(row.repo, number)),
    );
    const viewer = reads[0]?.viewer ?? user.login;
    return {
      row,
      repo: row.repo,
      reads,
      approvals: {
        viewer,
        prs: reads.map(({ pr }) => {
          const analysedHead = heads.get(pr.number) ?? null;
          return {
            number: pr.number,
            url: pr.url,
            analysedHead,
            liveHead: pr.headOid,
            review: pr.review,
            state: approvalState(pr, analysedHead, viewer),
          };
        }),
      },
    };
  }

  /** Puts GitHub's new review status on the user's Changes in the repo, for the Changes list. */
  function keepReviews(userId: string, repo: string, approvals: ApprovalsResponse) {
    const review = new Map(approvals.prs.map((pr) => [pr.number, pr.review]));
    const rows = db
      .select()
      .from(changes)
      .where(and(eq(changes.ownerId, userId), eq(changes.repo, repo)))
      .all();
    for (const row of rows) {
      if (!row.pathPrs) continue;
      const prs = JSON.parse(row.pathPrs) as PathPr[];
      let changed = false;
      const next = prs.map((pr) => {
        if (!review.has(pr.number) || review.get(pr.number) === pr.review) return pr;
        changed = true;
        return { ...pr, review: review.get(pr.number) ?? null };
      });
      if (changed) {
        db.update(changes)
          .set({ pathPrs: JSON.stringify(next) })
          .where(eq(changes.id, row.id))
          .run();
      }
    }
  }

  return app;
}

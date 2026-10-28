/**
 * Saving and describing Changes, shared by the routes (a Change you type in)
 * and the assignment search (a Change GitHub lists for you), so both make the
 * same Change for the same path.
 */
import type { AssignedReason, ChangeSummary, YourPr } from "@strata/core/model";
import { type ChangeInput, describeInput, describeRepo } from "@strata/core/model";
import type { ResolvedChange } from "@strata/engine";
import { and, eq } from "drizzle-orm";
import { newId } from "./auth/crypto.js";
import type { Db } from "./db/client.js";
import { assignments, type ChangeRow, changes } from "./db/schema.js";
import { latestRun, type RunQueue } from "./runs.js";

/** The PRs a resolved Change covers, bottom first. */
export function pathOf(resolved: ResolvedChange): number[] {
  const path = resolved.stack?.selectedPath ?? [];
  if (path.length === 0) throw new Error("A stack came back with no PRs.");
  return path;
}

/** The heads of a resolved Change's PRs, bottom first, as stored in `queuedHeads`. */
export function headsOf(resolved: ResolvedChange): string {
  const byNumber = new Map(resolved.stack?.nodes.map((node) => [node.pr.number, node.pr]) ?? []);
  return JSON.stringify(pathOf(resolved).map((n) => byNumber.get(n)?.headOid ?? null));
}

/**
 * Finds the user's Change for the resolved path, or makes it. A Change the
 * user asks for by hand becomes theirs ("added") even if the assignment
 * search made it first.
 */
export function saveChange(
  db: Db,
  args: {
    ownerId: string;
    input: ChangeInput;
    resolved: ResolvedChange;
    origin: "added" | "assigned";
    now: Date;
  },
): { row: ChangeRow; created: boolean } {
  const { ownerId, input, resolved, origin, now } = args;
  const path = pathOf(resolved);
  const rootPr = path[0] as number;
  const tipPr = path[path.length - 1] as number;
  const repo = describeRepo(input.repo);
  const existing = db
    .select()
    .from(changes)
    .where(
      and(
        eq(changes.ownerId, ownerId),
        eq(changes.repo, repo),
        eq(changes.rootPr, rootPr),
        eq(changes.tipPr, tipPr),
      ),
    )
    .get();
  if (existing) {
    const fields = {
      title: resolved.title,
      updatedAt: now,
      ...(origin === "added" ? { origin } : {}),
    };
    db.update(changes).set(fields).where(eq(changes.id, existing.id)).run();
    return { row: { ...existing, ...fields }, created: false };
  }
  const row: ChangeRow = {
    id: newId("chg"),
    ownerId,
    repo,
    rootPr,
    tipPr,
    input: describeInput(input),
    title: resolved.title,
    origin,
    queuedHeads: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(changes).values(row).run();
  return { row, created: true };
}

export function summarize(db: Db, row: ChangeRow): ChangeSummary {
  const yours: YourPr[] = db
    .select()
    .from(assignments)
    .where(eq(assignments.changeId, row.id))
    .all()
    .map((a) => ({
      number: a.pr,
      reasons: JSON.parse(a.reasons) as AssignedReason[],
      active: a.active,
      seenAt: a.lastSeenAt.toISOString(),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.number - b.number);
  return {
    id: row.id,
    title: row.title,
    repo: row.repo,
    input: row.input,
    status: latestRun(db, row.id)?.status ?? null,
    origin: row.origin,
    yours,
    waiting: yours.some((pr) => pr.active && pr.reasons.some((r) => r.kind !== "reviewed")),
    rootPr: row.rootPr,
    tipPr: row.tipPr,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Queues a run of the Change and notes the heads it will read, so the
 * assignment search re-runs it only once one of them moves.
 */
export function queueRun(db: Db, runs: RunQueue, row: ChangeRow, resolved: ResolvedChange) {
  const queuedHeads = headsOf(resolved);
  db.update(changes).set({ queuedHeads }).where(eq(changes.id, row.id)).run();
  return runs.enqueue({ ...row, queuedHeads });
}

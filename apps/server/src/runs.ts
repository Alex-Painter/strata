/**
 * Analysis runs, one at a time, in this process. A run asks the engine to
 * analyse its Change's path and stores the report. Runs left queued or
 * running by a previous process are marked failed at startup, since nothing
 * will finish them.
 */
import type { RunInfo } from "@strata/core/model";
import type { Engine } from "@strata/engine";
import { desc, eq, inArray } from "drizzle-orm";
import { newId } from "./auth/crypto.js";
import { pathPrsOf } from "./change-store.js";
import type { Db } from "./db/client.js";
import { type ChangeRow, changes, type RunRow, reports, runs } from "./db/schema.js";

export class RunQueue {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Db,
    /** The engine for the Change's owner, with their GitHub token. */
    private readonly engineFor: (ownerId: string) => Engine,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db
      .update(runs)
      .set({
        status: "failed",
        error: "Strata restarted before this run finished.",
        finishedAt: this.now(),
      })
      .where(inArray(runs.status, ["queued", "running"]))
      .run();
  }

  enqueue(change: ChangeRow): RunInfo {
    const run: RunRow = {
      id: newId("run"),
      changeId: change.id,
      status: "queued",
      progress: null,
      error: null,
      queuedAt: this.now(),
      startedAt: null,
      finishedAt: null,
    };
    this.db.insert(runs).values(run).run();
    this.chain = this.chain.then(() => this.execute(run.id, change));
    return runInfo(run);
  }

  /** Resolves once every queued run has finished. For tests and shutdown. */
  idle(): Promise<void> {
    return this.chain;
  }

  private async execute(runId: string, change: ChangeRow): Promise<void> {
    const update = (fields: Partial<RunRow>) =>
      this.db.update(runs).set(fields).where(eq(runs.id, runId)).run();
    update({ status: "running", startedAt: this.now() });
    try {
      const [owner, name] = change.repo.split("/") as [string, string];
      const report = await this.engineFor(change.ownerId).analyzeChange(
        {
          kind: "stack-of",
          repo: { kind: "github", owner, name },
          seed: { pr: change.rootPr, leaf: change.tipPr },
        },
        { onProgress: (step) => update({ progress: step }) },
      );
      const at = this.now();
      this.db.transaction((tx) => {
        tx.insert(reports)
          .values({
            id: newId("rpt"),
            changeId: change.id,
            runId,
            schemaVersion: report.schemaVersion,
            body: JSON.stringify(report),
            createdAt: at,
          })
          .run();
        tx.update(runs)
          .set({ status: "done", progress: null, finishedAt: at })
          .where(eq(runs.id, runId))
          .run();
        tx.update(changes)
          .set({
            title: report.change.title,
            // The PRs as this run found them: states change, and a merged bottom can leave.
            ...(report.stack ? { pathPrs: pathPrsOf(report.stack) } : {}),
            updatedAt: at,
          })
          .where(eq(changes.id, change.id))
          .run();
      });
    } catch (error) {
      console.error(
        `[strata] Run ${runId} failed:`,
        error instanceof Error ? error.message : error,
      );
      update({
        status: "failed",
        progress: null,
        error: error instanceof Error ? error.message : String(error),
        finishedAt: this.now(),
      });
    }
  }
}

export function latestRun(db: Db, changeId: string): RunRow | undefined {
  return db
    .select()
    .from(runs)
    .where(eq(runs.changeId, changeId))
    .orderBy(desc(runs.queuedAt), desc(runs.id))
    .get();
}

export function runInfo(run: RunRow): RunInfo {
  return {
    id: run.id,
    status: run.status,
    progress: run.progress,
    error: run.error,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

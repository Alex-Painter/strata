/**
 * Keeps the GitHub status of each Change's PRs fresh: open, merged or
 * closed, draft, review and checks. These come from GitHub, not from Claude,
 * so the Changes list and a Change's page read them again each time they
 * load, at most once per `minIntervalMs` per repo (or per Change). One
 * GraphQL request reads up to 100 PRs. A merged or closed PR is final, so
 * only Changes that still show an open PR are read.
 */
import type { PathPr } from "@strata/core/model";
import type { Engine } from "@strata/engine";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { type ChangeRow, changes } from "./db/schema.js";

/** The Changes list asks every 30 s; this keeps it to one GitHub request per repo per 30 s. */
const MIN_INTERVAL_MS = 30_000;
/** A page does not wait longer than this; a slower read finishes behind it. */
const WAIT_MS = 3_000;

export class PrStatusRefresher {
  private readonly last = new Map<string, number>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly engineFor: (userId: string) => Engine,
    private readonly options: {
      minIntervalMs?: number;
      waitMs?: number;
      now?: () => number;
      onError?: (error: unknown) => void;
    } = {},
  ) {}

  /**
   * Reads the open PRs of `rows` from GitHub again and saves what changed, on
   * every Change of the user in that repo. Waits up to `waitMs`, then returns.
   * `scope` names what the throttle counts: a repo for the list, a Change for its page.
   */
  async refresh(userId: string, rows: ChangeRow[], scope: "repo" | "change"): Promise<void> {
    const byRepo = new Map<string, ChangeRow[]>();
    for (const row of rows) byRepo.set(row.repo, [...(byRepo.get(row.repo) ?? []), row]);
    const reads = [...byRepo].map(([repo, repoRows]) => {
      const key = scope === "repo" ? `${userId}\0${repo}` : `${userId}\0${repoRows[0]?.id}`;
      return this.once(key, () => this.read(userId, repo, repoRows));
    });
    const wait = this.options.waitMs ?? WAIT_MS;
    await Promise.race([
      Promise.all(reads),
      new Promise((resolve) => setTimeout(resolve, wait).unref?.()),
    ]);
  }

  private once(key: string, read: () => Promise<void>): Promise<void> {
    const running = this.running.get(key);
    if (running) return running;
    const now = (this.options.now ?? Date.now)();
    if (
      now - (this.last.get(key) ?? Number.NEGATIVE_INFINITY) <
      (this.options.minIntervalMs ?? MIN_INTERVAL_MS)
    ) {
      return Promise.resolve();
    }
    this.last.set(key, now);
    const promise = read()
      .catch((error) => this.options.onError?.(error))
      .finally(() => this.running.delete(key));
    this.running.set(key, promise);
    return promise;
  }

  private async read(userId: string, repo: string, rows: ChangeRow[]): Promise<void> {
    const open = rows.flatMap((row) =>
      prsOf(row)
        .filter((pr) => pr.state === "open")
        .map((pr) => pr.number),
    );
    if (open.length === 0) return;
    const status = await this.engineFor(userId).readPrStatus(repo, open);
    if (status.size === 0) return;
    // Every Change in the repo, so two Changes that share a PR agree.
    const all = this.db
      .select()
      .from(changes)
      .where(and(eq(changes.ownerId, userId), eq(changes.repo, repo)))
      .all();
    for (const row of all) {
      const prs = prsOf(row);
      let changed = false;
      const next = prs.map((pr) => {
        const now = status.get(pr.number);
        if (!now) return pr;
        const merged = { ...pr, ...now };
        if (
          merged.state === pr.state &&
          merged.draft === pr.draft &&
          merged.review === pr.review &&
          merged.latestReview === pr.latestReview &&
          merged.checks === pr.checks &&
          merged.title === pr.title
        )
          return pr;
        changed = true;
        return merged;
      });
      if (changed) {
        this.db
          .update(changes)
          .set({ pathPrs: JSON.stringify(next) })
          .where(eq(changes.id, row.id))
          .run();
      }
    }
  }
}

function prsOf(row: ChangeRow): PathPr[] {
  return row.pathPrs ? (JSON.parse(row.pathPrs) as PathPr[]) : [];
}

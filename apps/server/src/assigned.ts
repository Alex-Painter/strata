/**
 * The assignment search: finds the open PRs GitHub lists for a user in the
 * repos Strata searches (assigned, or their review requested directly or
 * through a team) and makes each one's Change, exactly as typing the PR in
 * would. A lone PR gives a one-PR Change; a PR inside a stack gives the
 * Change for its whole path, so several of your PRs on one path share it.
 * A Change runs when it's new and again once one of its heads moves.
 */
import type { AssignedReason, AssignedStatus, ChangeInput } from "@strata/core/model";
import type { Engine } from "@strata/engine";
import { and, eq, notInArray } from "drizzle-orm";
import { newId } from "./auth/crypto.js";
import { DEV_USER_ID } from "./auth/routes.js";
import { headsOf, queueRun, saveChange } from "./change-store.js";
import type { Db } from "./db/client.js";
import { assignments, users } from "./db/schema.js";
import type { RunQueue } from "./runs.js";

interface UserState {
  running: Promise<void> | null;
  progress: string | null;
  lastFinishedAt: Date | null;
  errors: string[];
}

export class AssignedSearch {
  private readonly users = new Map<string, UserState>();

  constructor(
    private readonly db: Db,
    private readonly engineFor: (userId: string) => Engine,
    private readonly runs: RunQueue,
    /** `owner/name`, in the order they're searched. */
    readonly repos: readonly string[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  status(userId: string): AssignedStatus {
    const state = this.users.get(userId);
    return {
      repos: [...this.repos],
      running: Boolean(state?.running),
      progress: state?.progress ?? null,
      lastFinishedAt: state?.lastFinishedAt?.toISOString() ?? null,
      errors: state?.errors ?? [],
    };
  }

  /** Starts a search for the user, or joins the one already going. Never rejects. */
  search(userId: string): Promise<void> {
    const state = this.state(userId);
    if (!state.running) {
      state.running = this.searchAll(userId, state).finally(() => {
        state.running = null;
        state.progress = null;
        state.lastFinishedAt = this.now();
      });
    }
    return state.running;
  }

  /** Searches for each user now and then every `ms`. Returns a stop function. */
  every(userIds: () => string[], ms: number): () => void {
    const tick = () => {
      for (const id of userIds()) void this.search(id);
    };
    tick();
    const timer = setInterval(tick, ms);
    timer.unref();
    return () => clearInterval(timer);
  }

  private state(userId: string): UserState {
    let state = this.users.get(userId);
    if (!state) {
      state = { running: null, progress: null, lastFinishedAt: null, errors: [] };
      this.users.set(userId, state);
    }
    return state;
  }

  private async searchAll(userId: string, state: UserState): Promise<void> {
    const errors: string[] = [];
    for (const repo of this.repos) {
      try {
        await this.searchRepo(userId, repo, state, errors);
      } catch (error) {
        errors.push(`${repo}: ${message(error)}`);
      }
    }
    state.errors = errors;
    if (errors.length > 0) console.warn(`[strata] Assignment search: ${errors.join("; ")}`);
  }

  private async searchRepo(userId: string, repo: string, state: UserState, errors: string[]) {
    const engine = this.engineFor(userId);
    state.progress = `Strata searches ${repo}`;
    const found = await engine.findAssigned(repo);
    const [owner, name] = repo.split("/") as [string, string];
    for (const pr of found.prs) {
      state.progress = `Strata finds the stack for ${repo}#${pr.number}`;
      let changeId: string | null = null;
      let error: string | null = null;
      try {
        const input: ChangeInput = {
          kind: "stack-of",
          repo: { kind: "github", owner, name },
          seed: { pr: pr.number },
        };
        const resolved = await engine.resolveChange(input);
        const { row } = saveChange(this.db, {
          ownerId: userId,
          input,
          resolved,
          origin: "assigned",
          now: this.now(),
        });
        changeId = row.id;
        if (row.queuedHeads !== headsOf(resolved)) queueRun(this.db, this.runs, row, resolved);
      } catch (e) {
        error = message(e);
        errors.push(`${repo}#${pr.number}: ${error}`);
      }
      this.record(userId, repo, pr.number, pr.reasons, changeId, error);
    }
    // GitHub no longer lists the rest: merged, closed, unassigned or reviewed.
    this.db
      .update(assignments)
      .set({ active: false })
      .where(
        and(
          eq(assignments.ownerId, userId),
          eq(assignments.repo, repo),
          eq(assignments.active, true),
          notInArray(
            assignments.pr,
            found.prs.map((pr) => pr.number),
          ),
        ),
      )
      .run();
  }

  private record(
    userId: string,
    repo: string,
    pr: number,
    reasons: AssignedReason[],
    changeId: string | null,
    error: string | null,
  ) {
    const now = this.now();
    const existing = this.db
      .select()
      .from(assignments)
      .where(
        and(eq(assignments.ownerId, userId), eq(assignments.repo, repo), eq(assignments.pr, pr)),
      )
      .get();
    const fields = {
      reasons: JSON.stringify(reasons),
      active: true,
      error,
      lastSeenAt: now,
      // A failed resolve keeps the Change it had.
      changeId: changeId ?? existing?.changeId ?? null,
    };
    if (existing) {
      this.db.update(assignments).set(fields).where(eq(assignments.id, existing.id)).run();
    } else {
      this.db
        .insert(assignments)
        .values({ id: newId("asg"), ownerId: userId, repo, pr, firstSeenAt: now, ...fields })
        .run();
    }
  }
}

/** Who to search for: the dev bypass user, or everyone who has signed in with a token. */
export function searchedUsers(db: Db, devBypass: boolean): string[] {
  if (devBypass) return [DEV_USER_ID];
  return db
    .select({ id: users.id, token: users.githubTokenEnc })
    .from(users)
    .all()
    .flatMap((user) => (user.token ? [user.id] : []));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

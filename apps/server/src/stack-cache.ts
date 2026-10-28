import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StackSummary } from "@strata/core/model";
import { ENGINE_VERSION } from "@strata/engine";
import type { Jobs } from "./jobs.js";

/** How old a stack list can get before a page asks for a new read behind it. */
const MAX_AGE_MS = 10 * 60_000;

export interface StackList {
  stacks: StackSummary[];
  readAt: string;
}

export type StackListState =
  | { done: true; value: StackList; refreshing: boolean }
  | { done: false; progress: string | null };

interface Saved extends StackList {
  engineVersion: string;
}

/**
 * The last stack list for each user and repo. Reading a busy repo's
 * stacks takes minutes, so a page gets the last list at once, and a list
 * older than `maxAgeMs` is read again in the background. Lists are kept as
 * files under the data dir, so a restart doesn't lose them; a list from
 * another engine version is read again from scratch.
 */
export class StackCache {
  private readonly lists = new Map<string, StackList>();

  constructor(
    private readonly dataDir: string,
    private readonly jobs: Jobs,
    private readonly options: {
      maxAgeMs?: number;
      now?: () => Date;
      /** Told when a background read fails; the old list stays. */
      onError?: (error: unknown) => void;
    } = {},
  ) {}

  async get(
    scope: { userId: string; repo: string },
    read: (onProgress: (step: string) => void) => Promise<StackSummary[]>,
    signal?: AbortSignal,
  ): Promise<StackListState> {
    const file = this.fileFor(scope);
    const last = this.lists.get(file) ?? (await this.load(file));
    const now = this.options.now ?? (() => new Date());
    const age = last ? now().getTime() - Date.parse(last.readAt) : Number.POSITIVE_INFINITY;
    if (last && age < (this.options.maxAgeMs ?? MAX_AGE_MS)) {
      return { done: true, value: last, refreshing: false };
    }
    const reading = this.jobs.run(
      `stacks\0${file}`,
      async (onProgress) => {
        const list = { stacks: await read(onProgress), readAt: now().toISOString() };
        this.lists.set(file, list);
        await this.save(file, list);
        return list;
      },
      last ? undefined : signal,
    );
    if (last) {
      reading.catch((error) => this.options.onError?.(error));
      return { done: true, value: last, refreshing: true };
    }
    const state = await reading;
    return state.done ? { ...state, refreshing: false } : state;
  }

  private fileFor({ userId, repo }: { userId: string; repo: string }) {
    const [owner = "", name = ""] = repo.split("/");
    return path.join(
      this.dataDir,
      "cache",
      "stacks",
      encodeURIComponent(userId),
      encodeURIComponent(owner),
      `${encodeURIComponent(name)}.json`,
    );
  }

  private async load(file: string): Promise<StackList | null> {
    try {
      const saved = JSON.parse(await readFile(file, "utf8")) as Saved;
      if (saved.engineVersion !== ENGINE_VERSION) return null;
      const list = { stacks: saved.stacks, readAt: saved.readAt };
      this.lists.set(file, list);
      return list;
    } catch {
      return null;
    }
  }

  private async save(file: string, list: StackList) {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({ ...list, engineVersion: ENGINE_VERSION } satisfies Saved),
      );
    } catch (error) {
      // The list still serves from memory until the next restart.
      this.options.onError?.(error);
    }
  }
}

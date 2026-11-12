/**
 * Reads the usage log (one JSON line per Claude request, see llm.ts) and
 * groups it by task, model, day and Change. `strata usage` and the server's
 * GET /api/usage both use this, so the two always agree.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  UsageChangeRow,
  UsageDayRow,
  UsageModelRow,
  UsageSummary,
  UsageTaskRow,
  UsageTotals,
} from "@strata/core/model";
import { USAGE_FILE, type UsageEntry } from "./llm.js";

/** Every readable line of `<dataDir>/llm-usage.jsonl`; none when the file is missing. */
export async function readUsage(dataDir: string): Promise<UsageEntry[]> {
  let text: string;
  try {
    text = await readFile(path.join(dataDir, USAGE_FILE), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as UsageEntry];
    } catch {
      return [];
    }
  });
}

const empty = (): UsageTotals => ({
  requests: 0,
  cached: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  unpriced: 0,
});

function add(t: UsageTotals, entry: UsageEntry): void {
  if (entry.cached) t.cached += 1;
  else t.requests += 1;
  t.inputTokens += entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens;
  t.outputTokens += entry.outputTokens;
  if (entry.costUsd === null) t.unpriced += 1;
  else t.costUsd += entry.costUsd;
}

function group<R extends UsageTotals>(
  rows: Map<string, R>,
  key: string,
  make: () => R,
  entry: UsageEntry,
): R {
  let row = rows.get(key);
  if (!row) {
    row = make();
    rows.set(key, row);
  }
  add(row, entry);
  return row;
}

const byCost = <R extends UsageTotals>(rows: Map<string, R>): R[] =>
  [...rows.values()].sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);

/**
 * Groups the lines at or after `since`. A cached answer counts on its task,
 * day and Change, but not on a model: no model ran for it.
 */
export function summariseUsage(entries: UsageEntry[], since: Date): UsageSummary {
  const total = empty();
  const tasks = new Map<string, UsageTaskRow>();
  const models = new Map<string, UsageModelRow>();
  const days = new Map<string, UsageDayRow>();
  const changes = new Map<string, UsageChangeRow>();
  for (const entry of entries) {
    if (new Date(entry.at) < since) continue;
    add(total, entry);
    const task = group(
      tasks,
      entry.task,
      () => ({ task: entry.task, models: [], ...empty() }),
      entry,
    );
    if (!entry.cached) {
      if (!task.models.includes(entry.model)) task.models.push(entry.model);
      group(models, entry.model, () => ({ model: entry.model, ...empty() }), entry);
    }
    const day = entry.at.slice(0, 10);
    const dayRow = group(
      days,
      day,
      (): UsageDayRow => ({ day, costByTask: {}, ...empty() }),
      entry,
    );
    dayRow.costByTask[entry.task] = (dayRow.costByTask[entry.task] ?? 0) + (entry.costUsd ?? 0);
    const changeId = entry.changeId ?? null;
    group(
      changes,
      changeId ?? "",
      () => ({ changeId, repo: entry.repo ?? null, title: null, ...empty() }),
      entry,
    );
  }
  for (const task of tasks.values()) task.models.sort();
  return {
    since: since.toISOString(),
    total,
    byTask: byCost(tasks),
    byModel: byCost(models),
    byDay: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
    byChange: byCost(changes),
  };
}

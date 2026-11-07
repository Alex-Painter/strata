/**
 * `strata usage`: what Strata sent to Claude and what it cost, from the
 * usage file the engine appends to (one JSON line per request).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { USAGE_FILE, type UsageEntry } from "@strata/engine";

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

interface Totals {
  requests: number;
  cached: number;
  input: number;
  output: number;
  cost: number;
  unpriced: number;
}

function add(totals: Totals | undefined, entry: UsageEntry): Totals {
  const t = totals ?? { requests: 0, cached: 0, input: 0, output: 0, cost: 0, unpriced: 0 };
  if (entry.cached) t.cached += 1;
  else t.requests += 1;
  t.input += entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens;
  t.output += entry.outputTokens;
  if (entry.costUsd === null) t.unpriced += 1;
  else t.cost += entry.costUsd;
  return t;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function table(title: string, rows: Iterable<[string, Totals]>): string[] {
  const row = (cells: string[]) =>
    cells.map((cell, i) => (i === 0 ? cell.padEnd(20) : cell.padStart(9))).join(" ");
  return [
    row([title, "Requests", "Cached", "Input", "Output", "Cost"]),
    ...[...rows].map(([name, t]) =>
      row([
        name,
        String(t.requests),
        String(t.cached),
        tokens(t.input),
        tokens(t.output),
        `$${t.cost.toFixed(2)}${t.unpriced ? "*" : ""}`,
      ]),
    ),
  ];
}

const byCost = (rows: Map<string, Totals>) => [...rows].sort((a, b) => b[1].cost - a[1].cost);

export function formatUsage(entries: UsageEntry[], since: Date, dataDir: string): string {
  const recent = entries.filter((entry) => new Date(entry.at) >= since);
  const from = since.toISOString().slice(0, 10);
  if (recent.length === 0) {
    return `Strata did not ask Claude for anything since ${from} (${path.join(dataDir, USAGE_FILE)}).\n`;
  }
  const byTask = new Map<string, Totals>();
  const byModel = new Map<string, Totals>();
  const byDay = new Map<string, Totals>();
  let total: Totals | undefined;
  for (const entry of recent) {
    byTask.set(entry.task, add(byTask.get(entry.task), entry));
    if (!entry.cached) byModel.set(entry.model, add(byModel.get(entry.model), entry));
    const day = entry.at.slice(0, 10);
    byDay.set(day, add(byDay.get(day), entry));
    total = add(total, entry);
  }
  const t = total as Totals;
  const out = [
    `Claude usage since ${from}: ${t.requests} requests, $${t.cost.toFixed(2)}.`,
    "",
    ...table("Task", byCost(byTask)),
    "",
    ...table("Model", byCost(byModel)),
    "",
    ...table(
      "Day",
      [...byDay].sort((a, b) => b[0].localeCompare(a[0])),
    ),
  ];
  if (t.unpriced > 0) {
    out.push(
      "",
      "* Strata does not know the price of some models. Their cost is not in the total.",
    );
  }
  return `${out.join("\n")}\n`;
}

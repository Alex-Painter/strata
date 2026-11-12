/**
 * `strata usage`: what Strata sent to Claude and what it cost, from the
 * usage file the engine appends to (one JSON line per request). The web
 * app's Usage page shows the same numbers.
 */
import path from "node:path";
import type { UsageTotals } from "@strata/core/model";
import { readUsage, summariseUsage, USAGE_FILE, type UsageEntry } from "@strata/engine";

export { readUsage };

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function table(title: string, rows: Array<[string, UsageTotals]>): string[] {
  const row = (cells: string[]) =>
    cells.map((cell, i) => (i === 0 ? cell.padEnd(20) : cell.padStart(9))).join(" ");
  return [
    row([title, "Requests", "Cached", "Input", "Output", "Cost"]),
    ...rows.map(([name, t]) =>
      row([
        name,
        String(t.requests),
        String(t.cached),
        tokens(t.inputTokens),
        tokens(t.outputTokens),
        `$${t.costUsd.toFixed(2)}${t.unpriced ? "*" : ""}`,
      ]),
    ),
  ];
}

export function formatUsage(entries: UsageEntry[], since: Date, dataDir: string): string {
  const from = since.toISOString().slice(0, 10);
  const summary = summariseUsage(entries, since);
  const t = summary.total;
  if (t.requests + t.cached === 0) {
    return `Strata did not ask Claude for anything since ${from} (${path.join(dataDir, USAGE_FILE)}).\n`;
  }
  const out = [
    `Claude usage since ${from}: ${t.requests} requests, $${t.costUsd.toFixed(2)}.`,
    "",
    ...table(
      "Task",
      summary.byTask.map((r) => [r.task, r]),
    ),
    "",
    ...table(
      "Model",
      summary.byModel.map((r) => [r.model, r]),
    ),
    "",
    ...table(
      "Day",
      summary.byDay.map((r) => [r.day, r]),
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

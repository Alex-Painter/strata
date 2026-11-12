/**
 * GET /api/usage?days=7|30|90: what Strata sent to Claude in the period and
 * its estimated cost, from the engine's usage log in the data folder, by
 * feature, model, day and Change. With an admin key it adds the amount that
 * Anthropic bills. Nothing here asks Claude.
 */
import type { UsageResponse } from "@strata/core/model";
import { readUsage, summariseUsage } from "@strata/engine";
import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createBilling } from "../billing.js";
import { changes } from "../db/schema.js";
import type { AppDeps, AppEnv } from "../types.js";

export const USAGE_PERIODS = [7, 30, 90] as const;
const DAY = 86_400_000;

export function usageRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const billing =
    deps.billing ??
    createBilling(
      deps.config.anthropicAdmin
        ? {
            ...deps.config.anthropicAdmin,
            ...(deps.config.devAnthropicBaseUrl
              ? { baseUrl: deps.config.devAnthropicBaseUrl }
              : {}),
          }
        : null,
    );

  app.get("/usage", async (c) => {
    const days = Number(c.req.query("days") ?? 30);
    if (!(USAGE_PERIODS as readonly number[]).includes(days)) {
      return c.json({ error: "Set days to 7, 30 or 90." }, 400);
    }
    // Whole UTC days, today included, thus the chart has one bar a day.
    const today = Math.floor(Date.now() / DAY) * DAY;
    const since = new Date(today - (days - 1) * DAY);
    const [entries, billed] = await Promise.all([readUsage(deps.config.dataDir), billing(days)]);
    const summary = summariseUsage(entries, since);
    const ids = summary.byChange.flatMap((row) => (row.changeId ? [row.changeId] : []));
    const found = ids.length
      ? deps.db
          .select({ id: changes.id, title: changes.title, repo: changes.repo })
          .from(changes)
          .where(inArray(changes.id, ids))
          .all()
      : [];
    const byId = new Map(found.map((row) => [row.id, row]));
    for (const row of summary.byChange) {
      const change = row.changeId ? byId.get(row.changeId) : undefined;
      if (change) {
        row.title = change.title;
        row.repo = change.repo;
      }
    }
    return c.json<UsageResponse>({
      ...summary,
      days,
      billed: billed.billed,
      billedError: billed.error,
    });
  });

  return app;
}

/**
 * The real spend from Anthropic's Admin API, for the Usage page. The engine's
 * usage log gives an estimate per feature; this gives the amount Anthropic
 * bills. It makes no Claude request, so it costs nothing.
 *
 * With ANTHROPIC_API_KEY_ID, it reads the Usage and Cost Analytics API
 * (beta), which can filter by API key. Without it, or when that API refuses,
 * it reads the older cost report, which only gives the organization's total.
 * Both report cents as decimal strings, and allow at most 31 days a request.
 */
import type { BilledCost } from "@strata/core/model";

export interface BilledResult {
  billed: BilledCost | null;
  error: string | null;
}

export type Billing = (days: number) => Promise<BilledResult>;

const DAY = 86_400_000;
const MAX_DAYS = 31;
const CACHE_MS = 10 * 60_000;
const API = "https://api.anthropic.com";

interface Options {
  key: string;
  apiKeyId: string | null;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Null when the server has no admin key. Answers are kept for ten minutes. */
export function createBilling(options: Options | null): Billing {
  if (!options) return async () => ({ billed: null, error: null });
  const cache = new Map<number, { at: number; result: BilledResult }>();
  const now = options.now ?? (() => new Date());
  return async (days) => {
    const hit = cache.get(days);
    if (hit && now().getTime() - hit.at < CACHE_MS) return hit.result;
    const result = await readBilled(options, days, now()).catch(
      (error: unknown): BilledResult => ({
        billed: null,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    // Keep a failure for one minute only, so a fixed key shows soon.
    cache.set(days, { at: now().getTime() - (result.error ? CACHE_MS - 60_000 : 0), result });
    return result;
  };
}

class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBilled(options: Options, days: number, now: Date): Promise<BilledResult> {
  const end = new Date(Math.ceil(now.getTime() / DAY) * DAY);
  const start = new Date(end.getTime() - days * DAY);
  if (options.apiKeyId) {
    try {
      const cents = await sumWindows(start, end, (from, to) => analyticsCost(options, from, to));
      return { billed: { costUsd: cents / 100, scope: "key" }, error: null };
    } catch (error) {
      // 401 means a bad key: the older report fails the same way, so say so now.
      if (!(error instanceof AdminApiError) || error.status === 401) throw error;
    }
  }
  const cents = await sumWindows(start, end, (from, to) => costReport(options, from, to));
  return { billed: { costUsd: cents / 100, scope: "organization" }, error: null };
}

async function sumWindows(
  start: Date,
  end: Date,
  read: (from: Date, to: Date) => Promise<number>,
): Promise<number> {
  let total = 0;
  for (let from = start; from < end; ) {
    const to = new Date(Math.min(end.getTime(), from.getTime() + MAX_DAYS * DAY));
    total += await read(from, to);
    from = to;
  }
  return total;
}

async function get(options: Options, path: string, beta?: string): Promise<unknown> {
  const response = await (options.fetch ?? fetch)(`${options.baseUrl ?? API}${path}`, {
    headers: {
      "x-api-key": options.key,
      "anthropic-version": "2026-10-21",
      ...(beta ? { "anthropic-beta": beta } : {}),
      "user-agent": "strata",
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const detail = body?.error?.message ? ` ${body.error.message}` : "";
    throw new AdminApiError(
      response.status,
      `The Anthropic Admin API sent status ${response.status}.${detail}`,
    );
  }
  return response.json();
}

interface Page<T> {
  data: T[];
  has_more?: boolean;
  next_page?: string | null;
}

/** Follows next_page until the last page. */
async function pages<T>(
  options: Options,
  path: (page: string | null) => string,
  beta?: string,
): Promise<T[]> {
  const all: T[] = [];
  let page: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const body = (await get(options, path(page), beta)) as Page<T>;
    all.push(...(body.data ?? []));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return all;
}

const cents = (amount: string | number | undefined): number => Number(amount ?? 0) || 0;

/** The legacy cost report: the organization's cost, one bucket a day. */
async function costReport(options: Options, from: Date, to: Date): Promise<number> {
  const buckets = await pages<{ results?: Array<{ amount?: string }> }>(options, (page) => {
    const query = new URLSearchParams({
      starting_at: from.toISOString(),
      ending_at: to.toISOString(),
      bucket_width: "1d",
      limit: String(MAX_DAYS),
    });
    if (page) query.set("page", page);
    return `/v1/organizations/cost_report?${query}`;
  });
  return buckets.reduce(
    (sum, bucket) => sum + (bucket.results ?? []).reduce((s, r) => s + cents(r.amount), 0),
    0,
  );
}

/** The Usage and Cost Analytics API, filtered to one API key. */
async function analyticsCost(options: Options, from: Date, to: Date): Promise<number> {
  const rows = await pages<{ cost?: { amount?: string } }>(
    options,
    (page) => {
      const query = new URLSearchParams({
        starting_at: from.toISOString(),
        ending_at: to.toISOString(),
        time_bucket_width: "1d",
        limit: "1000",
      });
      query.append("api_key_ids[]", options.apiKeyId ?? "");
      if (page) query.set("page", page);
      return `/v1/organizations/analytics/cost?${query}`;
    },
    "analytics-usage-cost-2026-08-24",
  );
  return rows.reduce((sum, row) => sum + cents(row.cost?.amount), 0);
}

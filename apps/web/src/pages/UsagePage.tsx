import type { MeResponse, UsageResponse, UsageTotals } from "@strata/core/model";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { Info } from "../components/Info";
import { api } from "../lib/api";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** The name a person sees for each task in the usage log. A new task shows its own name. */
export const FEATURES: Record<string, { label: string; color: string; info: string }> = {
  layers: {
    label: "Layers",
    color: "var(--accent-2)",
    info: "Claude puts the files that the layer rules do not match in a layer.",
  },
  "pr-summary": {
    label: "PR summaries",
    color: "var(--add)",
    info: "Claude writes a short summary of each PR in a stack.",
  },
  "whole-summary": {
    label: "Whole-stack summary and Guide",
    color: "var(--chg)",
    info: "Claude writes the summary of the whole stack and the Guide.",
  },
  chat: {
    label: "Ask",
    color: "var(--hl-number)",
    info: "Claude answers the questions in the Ask tab.",
  },
};

const feature = (task: string) => FEATURES[task] ?? { label: task, color: "var(--fg-3)", info: "" };

export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** What Strata sent to Claude, and what it cost, by feature, day and Change. */
export function UsagePage({ me }: { me: MeResponse }) {
  const [days, setDays] = useState<Period>(30);
  const usage = useQuery({ queryKey: ["usage", days], queryFn: () => api.usage(days) });
  const data = usage.data;
  return (
    <AppShell
      me={me}
      navLabel="Strata"
      nav={<HomeNav current={null} page="usage" />}
      top={<Breadcrumb items={[{ label: "Usage" }]} />}
    >
      <main className="page">
        <div className="page-in gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="h1">
              Usage
              <Info text="Strata calculates each cost from the token counts and the list prices. The amount that Anthropic bills can be different." />
            </h1>
            <fieldset className="flex gap-1" aria-label="Period">
              {PERIODS.map((period) => (
                <button
                  key={period}
                  type="button"
                  className="chip cursor-pointer"
                  aria-pressed={days === period}
                  onClick={() => setDays(period)}
                >
                  {period} days
                </button>
              ))}
            </fieldset>
          </div>
          {usage.error && <p className="alert">{usage.error.message}</p>}
          {!data && !usage.error && (
            <p role="status" className="text-[13px] text-muted">
              Loading…
            </p>
          )}
          {data && <UsageBody data={data} />}
        </div>
      </main>
    </AppShell>
  );
}

function UsageBody({ data }: { data: UsageResponse }) {
  const t = data.total;
  if (t.requests + t.cached === 0) {
    return (
      <>
        <Totals data={data} />
        <div className="empty">Strata did not send a request to Claude in this period.</div>
      </>
    );
  }
  return (
    <>
      <Totals data={data} />
      <DayChart data={data} />
      <FeatureTable data={data} />
      <ChangeTable data={data} />
    </>
  );
}

function Stat({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="flex items-center text-[12px] text-faint">
        {label}
        {info && <Info text={info} />}
      </span>
      <span className="font-mono text-[20px] text-text tabular-nums">{value}</span>
    </div>
  );
}

function Totals({ data }: { data: UsageResponse }) {
  const t = data.total;
  return (
    <section className="grid gap-2" aria-label="Totals">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <Stat label="Estimated cost" value={money(t.costUsd)} />
        {data.billed && (
          <Stat
            label="Billed by Anthropic"
            value={money(data.billed.costUsd)}
            info={
              data.billed.scope === "key"
                ? "Anthropic's Admin API gives this amount for Strata's API key. It can be some hours late."
                : "Anthropic's Admin API gives this amount for all the API keys in the organization. It can be some hours late."
            }
          />
        )}
        <Stat label="Requests to Claude" value={String(t.requests)} />
        <Stat
          label="Answers from the cache"
          value={String(t.cached)}
          info="Strata used an answer that it kept before. These answers cost nothing."
        />
      </div>
      {t.unpriced > 0 && (
        <p className="text-[13px] text-faint">
          Strata does not know the price of some models. Their cost is not in the totals.
        </p>
      )}
      {data.billedError && (
        <p className="alert">Strata cannot read the billed amount. {data.billedError}</p>
      )}
    </section>
  );
}

/** One bar a day, oldest on the left, split by feature. */
function DayChart({ data }: { data: UsageResponse }) {
  const byDay = new Map(data.byDay.map((row) => [row.day, row]));
  const today = new Date();
  const days = Array.from({ length: data.days }, (_, i) => {
    const d = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - (data.days - 1 - i),
      ),
    );
    return d.toISOString().slice(0, 10);
  });
  const max = Math.max(...data.byDay.map((row) => row.costUsd), 0.000001);
  const tasks = data.byTask.map((row) => row.task);
  return (
    <section className="grid gap-3" aria-labelledby="day-h">
      <h2 id="day-h" className="h2">
        Cost each day
      </h2>
      <div className="grid gap-2">
        <ol className="flex h-32 items-end gap-px" aria-label="Cost each day">
          {days.map((day) => {
            const row = byDay.get(day);
            const cost = row?.costUsd ?? 0;
            const split = tasks
              .filter((task) => (row?.costByTask[task] ?? 0) > 0)
              .map((task) => `${feature(task).label} ${money(row?.costByTask[task] ?? 0)}`)
              .join(", ");
            const title = `${day}: ${money(cost)}${split ? ` (${split})` : ""}`;
            return (
              <li
                key={day}
                title={title}
                aria-label={title}
                className="flex h-full min-w-0 flex-1 flex-col-reverse hover:bg-hover"
              >
                {tasks.map((task) => {
                  const part = row?.costByTask[task] ?? 0;
                  if (part <= 0) return null;
                  return (
                    <div
                      key={task}
                      style={{ height: `${(part / max) * 100}%`, background: feature(task).color }}
                    />
                  );
                })}
              </li>
            );
          })}
        </ol>
        <div className="flex justify-between font-mono text-[11px] text-faint">
          <span>{days[0]}</span>
          <span>{days[days.length - 1]}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {tasks.map((task) => (
            <span key={task} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2 rounded-[2px]"
                style={{ background: feature(task).color }}
              />
              {feature(task).label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const th = "whitespace-nowrap px-3 py-1.5 font-normal";
const num = "whitespace-nowrap px-3 py-1.5 text-right font-mono text-[13px] tabular-nums";

function NumberCells({ row, total }: { row: UsageTotals; total: number }) {
  return (
    <>
      <td className={num}>{row.requests}</td>
      <td className={num}>{row.cached}</td>
      <td
        className={`${num} text-text`}
        title={`${tokens(row.inputTokens)} input tokens, ${tokens(row.outputTokens)} output tokens`}
      >
        {money(row.costUsd)}
        {row.unpriced > 0 ? "*" : ""}
      </td>
      <td className={`${num} text-faint`}>
        {total > 0 ? `${Math.round((row.costUsd / total) * 100)}%` : "–"}
      </td>
    </>
  );
}

function NumberHeads() {
  return (
    <>
      <th className={`${th} text-right`}>Requests</th>
      <th className={`${th} text-right`}>
        <span title="Answers from the cache">Cached</span>
      </th>
      <th className={`${th} text-right`}>Cost</th>
      <th className={`${th} text-right`}>Share</th>
    </>
  );
}

function FeatureTable({ data }: { data: UsageResponse }) {
  return (
    <section className="grid gap-3" aria-labelledby="feature-h">
      <h2 id="feature-h" className="h2">
        By feature
      </h2>
      <div className="list overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-left">
          <thead className="text-[12px] text-faint">
            <tr className="border-b border-line">
              <th className={th}>Feature</th>
              <th className={th}>Model</th>
              <NumberHeads />
            </tr>
          </thead>
          <tbody>
            {data.byTask.map((row) => {
              const f = feature(row.task);
              return (
                <tr key={row.task} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2 whitespace-nowrap font-medium text-text">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-[2px]"
                        style={{ background: f.color }}
                      />
                      {f.label}
                      {f.info && <Info text={f.info} />}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-muted">
                    {row.models.join(", ") || "–"}
                  </td>
                  <NumberCells row={row} total={data.total.costUsd} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChangeTable({ data }: { data: UsageResponse }) {
  return (
    <section className="grid gap-3" aria-labelledby="change-h">
      <h2 id="change-h" className="h2">
        By Change
        <Info text="Strata started to record the Change of each request on 12 November 2026. Earlier requests are in the row without a Change." />
      </h2>
      <div className="list overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-left">
          <thead className="text-[12px] text-faint">
            <tr className="border-b border-line">
              <th className={th}>Change</th>
              <NumberHeads />
            </tr>
          </thead>
          <tbody>
            {data.byChange.map((row) => (
              <tr key={row.changeId ?? "none"} className="border-b border-line last:border-b-0">
                <td className="min-w-0 max-w-[420px] px-3 py-1.5">
                  {row.changeId === null ? (
                    <span className="text-muted">No Change recorded</span>
                  ) : row.title ? (
                    <Link
                      href={`/changes/${encodeURIComponent(row.changeId)}`}
                      className="block truncate font-medium text-text"
                    >
                      {row.title}
                      {row.repo && (
                        <span className="ml-2 font-mono text-[12px] font-normal text-faint">
                          {row.repo}
                        </span>
                      )}
                    </Link>
                  ) : (
                    <span className="text-muted">
                      A deleted Change
                      {row.repo && (
                        <span className="ml-2 font-mono text-[12px] text-faint">{row.repo}</span>
                      )}
                    </span>
                  )}
                </td>
                <NumberCells row={row} total={data.total.costUsd} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

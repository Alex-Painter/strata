import type {
  AssignedStatus,
  ChangeSummary,
  MeResponse,
  RunStatus,
  StackSummary,
} from "@strata/core/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { api, isPending, pollWhilePending } from "../lib/api";
import { ago, countPrs, yoursLabel } from "../lib/format";

/**
 * The home page, by how much each Change asks of you: waiting on you (from
 * your GitHub assignments), assigned or reviewed but not waiting, and the
 * rest of each searched repo's stacks. Strata analyses the first two by
 * itself; the others only when you choose Analyse on their stack.
 */
export function ChangesPage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const assigned = useQuery({
    queryKey: ["assigned"],
    queryFn: api.assigned,
    // Quick while a search runs; otherwise often enough to see the server's own.
    refetchInterval: (query) => (query.state.data?.running ? 1000 : 30_000),
  });
  const lastFinished = assigned.data?.lastFinishedAt ?? null;
  const changes = useQuery({
    queryKey: ["changes", lastFinished],
    queryFn: api.changes,
    refetchInterval: 30_000,
  });
  const search = useMutation({
    mutationFn: api.searchAssigned,
    onSuccess: (status) => queryClient.setQueryData(["assigned"], status),
  });
  const all = changes.data;
  const error = changes.error?.message ?? null;
  const repos = assigned.data?.repos ?? [];
  // Your own Changes in repos Strata doesn't search have no stack list to sit in.
  const elsewhere = all?.filter((c) => c.yours.length === 0 && !repos.includes(c.repo)) ?? [];
  return (
    <AppShell
      me={me}
      navLabel="Strata"
      nav={<HomeNav current={null} />}
      top={<Breadcrumb items={[{ label: "Changes" }]} />}
    >
      <main className="page">
        <div className="page-in wide">
          <WaitingOnYou
            changes={all?.filter((c) => c.waiting)}
            error={error}
            status={assigned.data ?? null}
            searching={search.isPending || Boolean(assigned.data?.running)}
            onSearch={() => search.mutate()}
            searchError={search.error?.message ?? assigned.error?.message ?? null}
          />
          <section className="grid gap-3" aria-labelledby="assigned-h">
            <h2 id="assigned-h" className="h2">
              Assigned to you, not waiting
            </h2>
            <p className="-mt-1 text-[12px] text-muted">
              Stacks you've reviewed already, or were on before.
            </p>
            <ChangeList
              changes={all?.filter((c) => !c.waiting && c.yours.length > 0)}
              error={error}
              empty="Nothing here yet."
            />
          </section>
          {all &&
            repos.map((repo) => (
              <OtherStacks key={repo} repo={repo} changes={all.filter((c) => c.repo === repo)} />
            ))}
          {elsewhere.length > 0 && (
            <section className="grid gap-3" aria-labelledby="elsewhere-h">
              <h2 id="elsewhere-h" className="h2">
                Other Changes
              </h2>
              <ChangeList changes={elsewhere} error={null} empty="" />
            </section>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function WaitingOnYou({
  changes,
  error,
  status,
  searching,
  onSearch,
  searchError,
}: {
  changes: ChangeSummary[] | undefined;
  error: string | null;
  status: AssignedStatus | null;
  searching: boolean;
  onSearch: () => void;
  searchError: string | null;
}) {
  // With no repos to search there's nothing to refresh, but the list still shows.
  const searchable = !status || status.repos.length > 0;
  const repos = status?.repos.join(", ") ?? "";
  const note = searching
    ? (status?.progress ?? "Searching…")
    : status?.lastFinishedAt
      ? `Searched ${repos} ${ago(status.lastFinishedAt)}`
      : `Searches ${repos} for PRs assigned to you or asking for your review`;
  const problems = [...(searchError ? [searchError] : []), ...(status?.errors ?? [])];
  return (
    <section className="grid gap-3" aria-labelledby="waiting-h">
      <div className="flex items-center gap-3">
        <h2 id="waiting-h" className="h2 flex-1">
          Waiting on you
        </h2>
        {searchable && (
          <button type="button" className="btn h-8" disabled={searching} onClick={onSearch}>
            {searching ? "Searching…" : "Refresh"}
          </button>
        )}
      </div>
      {searchable && (
        <p className="-mt-1 text-[12px] text-muted" aria-live="polite">
          {note}
        </p>
      )}
      {problems.map((problem) => (
        <p key={problem} className="alert">
          {problem}
        </p>
      ))}
      <ChangeList changes={changes} error={error} empty="Nothing assigned to you right now." />
    </section>
  );
}

/**
 * The repo's open stacks that aren't yours. They're only analysed once you
 * choose Analyse on the stack, so most rows open the stack, not a Change.
 */
function OtherStacks({ repo, changes }: { repo: string; changes: ChangeSummary[] }) {
  const stacks = useQuery({
    queryKey: ["stacks", repo],
    queryFn: () => api.stacks(repo),
    refetchInterval: pollWhilePending,
  });
  const found = stacks.data && !isPending(stacks.data) ? stacks.data.stacks : null;
  const progress = isPending(stacks.data) ? stacks.data.progress : null;
  const covers = (stack: StackSummary, change: ChangeSummary) =>
    stack.prs.some((pr) => pr.number === change.tipPr);
  const yours = changes.filter((c) => c.yours.length > 0);
  const others = (found ?? []).filter(
    (stack) => stack.prs.some((pr) => pr.state === "open") && !yours.some((c) => covers(stack, c)),
  );
  const id = `others-${repo.replace("/", "-")}`;
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h2 id={id} className="h2">
        Other stacks in {repo}
      </h2>
      <p className="-mt-1 text-[12px] text-muted">
        Open stacks nobody has asked you about. Strata analyses one when you choose Analyse on it.
      </p>
      {stacks.error ? (
        <p className="alert">{stacks.error.message}</p>
      ) : !found ? (
        <p role="status" className="text-[12px] text-muted">
          Reading {repo}'s stacks…{progress ? ` ${progress}.` : ""}
        </p>
      ) : others.length === 0 ? (
        <div className="empty">No other open stacks.</div>
      ) : (
        <ul className="list">
          {others.map((stack) => {
            const change = changes.find((c) => c.yours.length === 0 && covers(stack, c));
            const root = stack.prs.find((pr) => pr.number === stack.root);
            const authors = [...new Set(stack.prs.flatMap((pr) => (pr.author ? [pr.author] : [])))];
            return (
              <li key={stack.id}>
                <Link
                  href={change ? `/changes/${change.id}` : `/repos/${repo}#stack-${stack.root}`}
                  className="lrow"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{root?.title}</span>
                    <span className="ml-2 text-[12px] text-muted">
                      {countPrs(stack.prs)}
                      {authors.length > 0 && ` by ${authors.join(", ")}`}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-faint">
                    {repo}#{stack.root}
                  </span>
                  <span className="pill">
                    {change?.status ? STATUS[change.status] : "Not analysed"}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[12px] text-faint">
                    {ago(stack.updatedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const STATUS: Record<RunStatus, string> = {
  queued: "Queued",
  running: "Running",
  done: "Analysed",
  failed: "Failed",
};

function ChangeList({
  changes,
  error,
  empty,
}: {
  changes: ChangeSummary[] | undefined;
  error: string | null;
  empty: string;
}) {
  if (error) return <p className="alert">{error}</p>;
  if (!changes) return null;
  if (changes.length === 0) return <div className="empty">{empty}</div>;
  return (
    <ul className="list">
      {changes.map((change) => (
        <li key={change.id}>
          <Link href={`/changes/${change.id}`} className="lrow">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{change.title}</span>
              {change.yours.length > 0 && (
                <span className="ml-2 text-[12px] text-muted">{yoursLabel(change.yours)}</span>
              )}
            </span>
            <span className="shrink-0 font-mono text-[12px] text-faint">{change.input}</span>
            {change.status && <span className="pill">{STATUS[change.status]}</span>}
            <span className="w-16 shrink-0 text-right text-[12px] text-faint">
              {ago(change.updatedAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

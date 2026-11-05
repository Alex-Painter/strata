import type {
  AssignedStatus,
  AuthoredPr,
  AuthoredResponse,
  ChangeSummary,
  MeResponse,
  PathPr,
  RunStatus,
  StackSummary,
  StacksResponse,
} from "@strata/core/model";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { Icon } from "../components/Icon";
import { Info } from "../components/Info";
import { api, isPending, pollStacks } from "../lib/api";
import { ago, countPrs, yoursLabel } from "../lib/format";
import { prUrl } from "../lib/github";
import { type ReviewStatus, type ReviewStatusKind, reviewStatus } from "../lib/status";
import { useStored } from "../lib/stored";
import { ReadAt } from "./StacksPage";

/**
 * The home page, by how much each Change asks of you: waiting on you (from
 * your GitHub assignments), assigned or reviewed but not waiting, your own
 * open PRs and their stacks, ones you added yourself, and the rest of each
 * searched repo's open stacks. Strata analyses the first two by itself; a
 * stack or PR only once you choose it.
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
  const [showTeams, setShowTeams] = useStored("strata-show-team-requests", true);
  const hidden = changes.data?.filter(teamOnly).length ?? 0;
  const all = showTeams ? changes.data : changes.data?.filter((c) => !teamOnly(c));
  const error = changes.error?.message ?? null;
  const repos = assigned.data?.repos ?? [];
  const authored = useQueries({
    queries: repos.map((repo) => ({
      queryKey: ["authored", repo],
      queryFn: () => api.authored(repo),
      // One GitHub search each time; GitHub limits searches to 30 a minute.
      refetchInterval: 60_000,
    })),
  });
  // The same queries as each repo's "Other stacks", so the list is read once.
  const stackLists = useQueries({
    queries: repos.map((repo) => ({
      queryKey: ["stacks", repo],
      queryFn: () => api.stacks(repo),
      refetchInterval: pollStacks,
    })),
  });
  const yours = repos.map((repo, i) => {
    const stacksData = stackLists[i]?.data;
    return yourRepo(
      repo,
      authored[i]?.data ?? null,
      stacksData && !isPending(stacksData) ? stacksData : null,
      changes.data ?? [],
    );
  });
  const shownChanges = new Set(yours.flatMap((y) => y.changeIds));
  const shownStacks = new Set(yours.flatMap((y) => y.stackIds));
  // A path the search made that no longer holds your PRs (they moved to a
  // longer path) is one you were on before, not one you added.
  const added =
    all?.filter((c) => c.yours.length === 0 && c.origin === "added" && !shownChanges.has(c.id)) ??
    [];
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
            teams={{ show: showTeams, hidden, onChange: setShowTeams }}
          />
          <section className="grid gap-3" aria-labelledby="assigned-h">
            <h2 id="assigned-h" className="h2">
              Assigned to you, not waiting
              <Info text="Stacks that you reviewed before, or that you were on before." />
            </h2>
            <ChangeList
              changes={all?.filter(
                (c) => !c.waiting && (c.yours.length > 0 || c.origin === "assigned"),
              )}
              error={error}
              empty="There are no stacks here at this time."
            />
          </section>
          {repos.length > 0 && (
            <YourPrs
              repos={yours}
              errors={authored.flatMap((q, i) =>
                q.error ? [`${repos[i]}: ${q.error.message}`] : [],
              )}
            />
          )}
          {added.length > 0 && (
            <section className="grid gap-3" aria-labelledby="added-h">
              <h2 id="added-h" className="h2">
                Added by you
                <Info text="Stacks that you selected for analysis. Nobody asked you to review them." />
              </h2>
              <ChangeList changes={added} error={null} empty="" />
            </section>
          )}
          {all &&
            repos.map((repo) => (
              <OtherStacks
                key={repo}
                repo={repo}
                changes={all.filter((c) => c.repo === repo)}
                hide={shownStacks}
              />
            ))}
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
  teams,
}: {
  changes: ChangeSummary[] | undefined;
  error: string | null;
  status: AssignedStatus | null;
  searching: boolean;
  onSearch: () => void;
  searchError: string | null;
  teams: { show: boolean; hidden: number; onChange: (show: boolean) => void };
}) {
  // With no repos to search there's nothing to refresh, but the list still shows.
  const searchable = !status || status.repos.length > 0;
  const repos = status?.repos.join(", ") ?? "";
  const note = searching
    ? (status?.progress ?? "Searching…")
    : status?.lastFinishedAt
      ? `Searched ${repos} ${ago(status.lastFinishedAt)}`
      : `Strata searches ${repos} for PRs that are assigned to you or that ask for your review`;
  const problems = [...(searchError ? [searchError] : []), ...(status?.errors ?? [])];
  return (
    <section className="grid gap-3" aria-labelledby="waiting-h">
      <div className="flex items-center gap-3">
        <h2 id="waiting-h" className="h2 flex-1">
          Waiting on you
        </h2>
        <label className="flex items-center gap-1.5 text-[13px] text-muted">
          <input
            type="checkbox"
            checked={teams.show}
            onChange={(event) => teams.onChange(event.target.checked)}
          />
          Show team requests
          {!teams.show && teams.hidden > 0 && ` (${teams.hidden} hidden)`}
        </label>
        {searchable && (
          <button type="button" className="btn h-8" disabled={searching} onClick={onSearch}>
            {searching ? "Searching…" : "Refresh"}
          </button>
        )}
      </div>
      {searchable && (
        <p className="-mt-1 text-[13px] text-muted" aria-live="polite">
          {note}
        </p>
      )}
      {problems.map((problem) => (
        <p key={problem} className="alert">
          {problem}
        </p>
      ))}
      <ChangeList
        changes={changes}
        error={error}
        empty="Nobody assigned a stack to you at this time."
      />
    </section>
  );
}

/**
 * The repo's open stacks with no Change yet. They're only analysed once you
 * choose Analyse on the stack; then they move up to your Changes.
 */
function OtherStacks({
  repo,
  changes,
  hide,
}: {
  repo: string;
  changes: ChangeSummary[];
  /** Stacks that another section shows, such as your own. */
  hide: ReadonlySet<string>;
}) {
  const stacks = useQuery({
    queryKey: ["stacks", repo],
    queryFn: () => api.stacks(repo),
    refetchInterval: pollStacks,
  });
  const list = stacks.data && !isPending(stacks.data) ? stacks.data : null;
  const found = list?.stacks ?? null;
  const progress = isPending(stacks.data) ? stacks.data.progress : null;
  const covers = (stack: StackSummary, change: ChangeSummary) =>
    stack.prs.some((pr) => pr.number === change.tipPr);
  const others = (found ?? []).filter(
    (stack) =>
      stack.prs.some((pr) => pr.state === "open") &&
      !hide.has(stack.id) &&
      !changes.some((c) => covers(stack, c)),
  );
  const id = `others-${repo.replace("/", "-")}`;
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h2 id={id} className="h2">
        Other stacks in {repo}
        <Info text="Open stacks that nobody asked you to review. Strata did not analyse them. Select a stack to see and analyse it." />
      </h2>
      {list && (
        <p className="-mt-1">
          <ReadAt readAt={list.readAt} refreshing={list.refreshing} />
        </p>
      )}
      {stacks.error ? (
        <p className="alert">{stacks.error.message}</p>
      ) : !found ? (
        <p role="status" className="text-[13px] text-muted">
          Strata reads the stacks in {repo}…{progress ? ` ${progress}.` : ""}
        </p>
      ) : others.length === 0 ? (
        <div className="empty">There are no other open stacks.</div>
      ) : (
        <ChangeTable
          rows={others.map((stack) => ({
            ...stackRow(stack),
            // No PR here asks for you: show only the path length.
            place: {
              label: `–/${stack.defaultPath.length}`,
              detail: `No PR in this stack asks for you. The path from #${stack.root} has ${stack.defaultPath.length} PRs.`,
            },
          }))}
        />
      )}
    </section>
  );
}

/** A stack with no Change yet, as a row that opens it on the Stacks page. */
function stackRow(stack: StackSummary): Row {
  const root = stack.prs.find((pr) => pr.number === stack.root);
  return {
    key: stack.id,
    href: `/repos/${stack.repo}#stack-${stack.root}`,
    title: root?.title ?? `#${stack.root}`,
    note: countPrs(stack.prs),
    repo: stack.repo,
    rootPr: stack.root,
    tipPr: null,
    prs: stack.prs,
    githubPr: stack.root,
    place: null,
    status: reviewStatus(stack.prs, { waiting: false, reviewed: false }),
    strata: "Not analysed",
  };
}

interface YourRepo {
  repo: string;
  /** Null until both your PRs and the repo's stacks are read. */
  rows: (Row | LonePr)[] | null;
  /** The Changes and stacks the rows show, so other sections do not show them again. */
  changeIds: string[];
  stackIds: string[];
}

/** One of your PRs with no stack and no Change: selecting it makes and runs its Change. */
interface LonePr {
  lone: AuthoredPr;
  repo: string;
}

/**
 * Your open PRs in one repo as rows: the Change that holds a PR if there is
 * one, else its stack, else the PR alone. A Change or stack shows once,
 * however many of your PRs it holds.
 */
function yourRepo(
  repo: string,
  authored: AuthoredResponse | null,
  stacks: StacksResponse | null,
  changes: ChangeSummary[],
): YourRepo {
  const result: YourRepo = { repo, rows: null, changeIds: [], stackIds: [] };
  if (!authored || !stacks) return result;
  const rows: (Row | LonePr)[] = [];
  const mine = authored.prs.map((pr) => pr.number);
  for (const pr of authored.prs) {
    const change = changes.find(
      (c) => c.repo === repo && c.prs.some((p) => p.number === pr.number),
    );
    if (change) {
      if (result.changeIds.includes(change.id)) continue;
      result.changeIds.push(change.id);
      const path = change.prs.map((p) => p.number);
      rows.push({
        ...changeRow(change),
        note: null,
        place: placeOf(
          path.filter((n) => mine.includes(n)),
          path,
        ),
        // Your own PRs do not wait on you.
        status: reviewStatus(change.prs, { waiting: false, reviewed: false }),
      });
      continue;
    }
    const stack = stacks.stacks.find((s) => s.prs.some((p) => p.number === pr.number));
    if (stack) {
      if (result.stackIds.includes(stack.id)) continue;
      result.stackIds.push(stack.id);
      rows.push({
        ...stackRow(stack),
        place: placeOf(
          stack.defaultPath.filter((n) => mine.includes(n)),
          stack.defaultPath,
        ),
      });
      continue;
    }
    rows.push({ lone: pr, repo });
  }
  result.rows = rows;
  return result;
}

function YourPrs({ repos, errors }: { repos: YourRepo[]; errors: string[] }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const open = useMutation({
    mutationFn: (input: string) => api.createChange({ input }),
    onSuccess: (detail) => {
      queryClient.setQueryData(["change", detail.change.id], detail);
      queryClient.invalidateQueries({ queryKey: ["changes"] });
      navigate(`/changes/${detail.change.id}`);
    },
  });
  const waitingFor = repos.filter((r) => !r.rows).map((r) => r.repo);
  const rows = repos
    .flatMap((r) => r.rows ?? [])
    .map((row): Row => {
      if (!("lone" in row)) return row;
      const { lone: pr, repo } = row;
      const input = `${repo}#${pr.number}`;
      return {
        key: `pr-${input}`,
        href: null,
        onOpen: () => {
          if (!open.isPending) open.mutate(input);
        },
        title: pr.title,
        note: null,
        repo,
        rootPr: pr.number,
        tipPr: null,
        prs: [pr],
        githubPr: pr.number,
        place: null,
        status: reviewStatus([pr], { waiting: false, reviewed: false }),
        strata: open.isPending && open.variables === input ? "Opening…" : "Not analysed",
      };
    });
  return (
    <section className="grid gap-3" aria-labelledby="yours-h">
      <h2 id="yours-h" className="h2">
        Your PRs and stacks
        <Info text="Open PRs that you opened on GitHub, with their stacks. Strata analyses a PR or a stack only when you select it." />
      </h2>
      {[...errors, ...(open.error ? [open.error.message] : [])].map((problem) => (
        <p key={problem} className="alert">
          {problem}
        </p>
      ))}
      {rows.length > 0 && <ChangeTable rows={rows} />}
      {waitingFor.length > 0 && errors.length === 0 ? (
        <p role="status" className="text-[13px] text-muted">
          Strata reads your PRs in {waitingFor.join(", ")}…
        </p>
      ) : (
        rows.length === 0 &&
        errors.length === 0 && <div className="empty">You have no open PRs at this time.</div>
      )}
    </section>
  );
}

/**
 * True when GitHub asks for your review only through a team: no PR on the
 * path names you directly, as assignee or as reviewer.
 */
function teamOnly(change: ChangeSummary): boolean {
  const active = change.yours.filter((pr) => pr.active);
  return (
    active.length > 0 &&
    active.every((pr) => pr.reasons.every((r) => r.kind === "review-requested" && !r.direct))
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
  return <ChangeTable rows={changes.map(changeRow)} />;
}

function changeRow(change: ChangeSummary): Row {
  const path = change.prs.map((pr) => pr.number);
  // Your PRs that GitHub still lists for you, bottom first; the button opens the lowest.
  const mine = path.filter((n) => change.yours.some((pr) => pr.active && pr.number === n));
  const active = mine[0] ?? change.yours.find((pr) => pr.active)?.number;
  return {
    key: change.id,
    href: `/changes/${change.id}`,
    title: change.title,
    note: change.yours.length > 0 ? yoursLabel(change.yours) : null,
    repo: change.repo,
    rootPr: change.rootPr,
    tipPr: change.tipPr,
    prs: change.prs,
    githubPr: active ?? change.rootPr,
    place: placeOf(mine.length > 0 ? mine : [active ?? change.rootPr], path),
    status: reviewStatus(change.prs, {
      waiting: change.waiting,
      reviewed: change.yours.some((pr) => pr.reasons.some((r) => r.kind === "reviewed")),
    }),
    strata: change.status ? STATUS[change.status] : null,
  };
}

interface Row {
  key: string;
  /** Where the row goes; null when `onOpen` does the work instead. */
  href: string | null;
  onOpen?: () => void;
  title: string;
  note: string | null;
  repo: string;
  rootPr: number;
  tipPr: number | null;
  prs: PathPr[];
  /** The PR the GitHub button opens. */
  githubPr: number;
  /** Where the row's PRs sit in the path, as "2/4" or "2, 3/4"; "–/4" when none of them is yours. */
  place: { label: string; detail: string } | null;
  status: ReviewStatus | null;
  strata: string | null;
}

/** Where `prs` sit on `path`, bottom first, counted from 1. */
function placeOf(prs: number[], path: number[]): Row["place"] {
  const at = prs.filter((n) => path.includes(n));
  if (at.length === 0) return null;
  const positions = at.map((n) => path.indexOf(n) + 1);
  return {
    label: `${positions.join(", ")}/${path.length}`,
    detail: at
      .map((n, i) => `#${n} is PR ${positions[i]} of ${path.length} in the stack.`)
      .join(" "),
  };
}

const TONE: Record<ReviewStatusKind, string> = {
  "needs-you": "text-accent",
  ready: "text-add",
  "changes-requested": "text-del",
  "checks-failed": "text-del",
  draft: "text-faint",
  merged: "text-faint",
  closed: "text-faint",
  reviewed: "text-muted",
  "needs-review": "text-muted",
};

/** A PR number that opens the PR on GitHub in a new tab, not the Change. */
function PrLink({ repo, number }: { repo: string; number: number }) {
  return (
    <a
      href={prUrl(repo, number)}
      target="_blank"
      rel="noreferrer"
      title={`Open #${number} on GitHub`}
      className="hover:text-text hover:underline"
    >
      #{number}
    </a>
  );
}

/** Changes or stacks as a table: what, who, when opened, review status, Strata's run, GitHub. */
function ChangeTable({ rows }: { rows: Row[] }) {
  const [, navigate] = useLocation();
  return (
    <div className="list overflow-x-auto">
      <table className="w-full min-w-[840px] table-fixed border-collapse text-left">
        <colgroup>
          <col />
          <col className="w-32" />
          <col className="w-20" />
          <col className="w-24" />
          <col className="w-40" />
          <col className="w-28" />
          <col className="w-10" />
        </colgroup>
        <thead className="text-[12px] text-faint">
          <tr className="border-b border-line">
            <th className="px-3 py-1.5 font-normal">Change</th>
            <th className="px-3 py-1.5 font-normal">Author</th>
            <th className="px-3 py-1.5 font-normal">In stack</th>
            <th className="px-3 py-1.5 font-normal">Opened</th>
            <th className="px-3 py-1.5 font-normal">Status</th>
            <th className="px-3 py-1.5 font-normal">Strata</th>
            <th className="px-3 py-1.5 font-normal">
              <span className="sr-only">GitHub</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const authors = [...new Set(row.prs.flatMap((pr) => pr.author ?? []))];
            const opened = row.prs
              .map((pr) => pr.createdAt)
              .filter(Boolean)
              .sort()[0];
            return (
              <tr
                key={row.key}
                className="cursor-pointer border-b border-line last:border-b-0 hover:bg-hover"
                onClick={(event) => {
                  if ((event.target as Element).closest("a, button")) return;
                  if (row.href) navigate(row.href);
                  else row.onOpen?.();
                }}
              >
                <td className="min-w-0 px-3 py-1.5">
                  {row.href ? (
                    <Link href={row.href} className="block truncate font-medium text-text">
                      {row.title}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={row.onOpen}
                      className="block w-full truncate text-left font-medium text-text"
                    >
                      {row.title}
                    </button>
                  )}
                  <span className="block truncate text-[13px] text-faint">
                    <span className="font-mono">
                      {row.repo}
                      <PrLink repo={row.repo} number={row.rootPr} />
                      {row.tipPr !== null && row.tipPr !== row.rootPr && (
                        <>
                          {" → "}
                          <PrLink repo={row.repo} number={row.tipPr} />
                        </>
                      )}
                    </span>
                    {row.note && <span className="ml-2 text-muted">{row.note}</span>}
                  </span>
                </td>
                <td
                  className="truncate px-3 py-1.5 text-[13px] text-muted"
                  title={authors.join(", ")}
                >
                  {authors.join(", ")}
                </td>
                <td
                  className="px-3 py-1.5 font-mono text-[13px] text-muted"
                  title={row.place?.detail}
                >
                  {row.place?.label}
                </td>
                <td className="px-3 py-1.5 text-[13px] text-muted" title={opened}>
                  {opened ? ago(opened) : ""}
                </td>
                <td
                  className={`truncate px-3 py-1.5 text-[13px] ${row.status ? TONE[row.status.kind] : ""}`}
                  title={row.status?.detail}
                >
                  {row.status?.label}
                </td>
                <td className="px-3 py-1.5">
                  {row.strata && <span className="pill">{row.strata}</span>}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <a
                    href={prUrl(row.repo, row.githubPr)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open #${row.githubPr} on GitHub`}
                    title={`Open #${row.githubPr} on GitHub`}
                    className="inline-flex size-7 items-center justify-center rounded-md text-faint hover:bg-active hover:text-text"
                  >
                    <Icon name="external" />
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

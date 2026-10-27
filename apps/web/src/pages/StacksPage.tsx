import type { MeResponse, StackSummary } from "@strata/core/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { EvidenceList } from "../components/EvidenceList";
import { PathPicker } from "../components/PathPicker";
import { CopyMermaid, StackMap } from "../components/StackMap";
import { api, isPending, pollWhilePending } from "../lib/api";
import { ago, countPrs, prCount } from "../lib/format";
import { useLatestRequest } from "../lib/latest-request";

/** Every stack in a repo, newest activity first, each ready to open as a Change. */
export function StacksPage({ me }: { me: MeResponse }) {
  const { owner, name } = useParams<{ owner: string; name: string }>();
  const repo = `${owner}/${name}`;
  const stacks = useQuery({
    queryKey: ["stacks", repo],
    queryFn: () => api.stacks(repo),
    // The server answers "still reading" until the repo's first read is done,
    // and keeps the result a few minutes, so keep asking from a background tab.
    refetchInterval: pollWhilePending,
    refetchIntervalInBackground: true,
  });
  const found = stacks.data && !isPending(stacks.data) ? stacks.data : null;
  const progress = isPending(stacks.data) ? stacks.data.progress : null;
  return (
    <AppShell
      me={me}
      navLabel="Strata"
      nav={<HomeNav current={repo} />}
      top={<Breadcrumb items={[{ label: "Changes", href: "/" }, { label: repo }]} />}
    >
      <main className="page">
        <div className="page-in gap-4">
          <header className="grid gap-1">
            <h1 className="h1">Stacks in {repo}</h1>
            <p className="text-muted">
              PRs whose branches feed into each other, from PRs updated in the last 90 days.
            </p>
          </header>
          {!stacks.error && (stacks.isPending || isPending(stacks.data)) && (
            <p role="status" className="text-muted">
              Reading {repo}'s PRs and fetching their branches…
              {progress && <span className="block">{progress}.</span>}
            </p>
          )}
          {stacks.error && (
            <div role="alert" className="alert grid justify-items-start gap-2">
              <p>{stacks.error.message}</p>
              <button
                type="button"
                onClick={() => stacks.refetch()}
                disabled={stacks.isFetching}
                className="btn"
              >
                Try again
              </button>
            </div>
          )}
          {found?.stacks.length === 0 && (
            <div className="empty">No stacks here: no recent PR targets another PR's branch.</div>
          )}
          {found?.stacks.map((stack) => (
            <StackCard key={stack.id} stack={stack} />
          ))}
        </div>
      </main>
    </AppShell>
  );
}

function StackCard({ stack }: { stack: StackSummary }) {
  const [tip, setTip] = useState(stack.defaultPath[stack.defaultPath.length - 1] as number);
  // A refreshed list can end the chosen path elsewhere; the card then shows the default.
  const path = stack.paths.find((p) => p[p.length - 1] === tip) ?? stack.defaultPath;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const request = useLatestRequest();
  const open = useMutation({
    // Opens the path the card shows.
    mutationFn: (leaf: number) =>
      api.createChange({ input: `${stack.repo}#${stack.root}`, leaf }, { signal: request.next() }),
    onSuccess: (detail) => {
      queryClient.setQueryData(["change", detail.change.id], detail);
      queryClient.invalidateQueries({ queryKey: ["changes"] });
      navigate(`/changes/${detail.change.id}`);
    },
  });
  const root = stack.prs.find((pr) => pr.number === stack.root);
  // Opening a path the card no longer shows would take the user to the wrong Change.
  const choose = (next: number) => {
    request.stop();
    open.reset();
    setTip(next);
  };

  return (
    <article aria-label={`Stack from #${stack.root}`} className="rounded-lg border border-line">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{root?.title}</h2>
          <p className="text-[12px] text-muted">
            {countPrs(stack.prs)} · updated {ago(stack.updatedAt)}
          </p>
        </div>
        <CopyMermaid stack={stack} />
      </header>
      <div className="px-2 py-2">
        <StackMap
          stack={stack}
          path={path}
          // Choosing a PR picks a path through it, keeping the current one when it already does.
          onSelect={(pr) => {
            if (path.includes(pr)) return;
            const through = stack.paths.find((p) => p.includes(pr));
            if (through) choose(through[through.length - 1] as number);
          }}
        />
      </div>
      <footer className="space-y-2 border-t border-line px-4 py-3">
        <PathPicker stack={stack} current={path} onPick={choose} />
        {stack.issues.map((issue) => (
          <div key={`${issue.kind} ${issue.prs.join(",")}`} className="note text-text">
            {issue.message}
            <EvidenceList repo={stack.repo} evidence={issue.evidence} />
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => open.mutate(path[path.length - 1] as number)}
            disabled={open.isPending}
            className="btn primary"
          >
            {open.isPending ? "Opening…" : `Review ${prCount(path.length)}`}
          </button>
          {open.error && (
            <span role="alert" className="text-text">
              {open.error.message}
            </span>
          )}
        </div>
      </footer>
    </article>
  );
}

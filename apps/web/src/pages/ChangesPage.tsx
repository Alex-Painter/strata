import type { ChangeSummary, MeResponse, RunStatus } from "@strata/core/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { inputHint } from "../lib/input";
import { useLatestRequest } from "../lib/latest-request";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Start a review from a PR or branch, browse a repo's stacks, or reopen a Change. */
export function ChangesPage({ me }: { me: MeResponse }) {
  const changes = useQuery({ queryKey: ["changes"], queryFn: api.changes });
  const repos = [...new Set((changes.data ?? []).map((change) => change.repo))];
  return (
    <AppShell
      me={me}
      navLabel="Strata"
      nav={<HomeNav current={null} />}
      top={<Breadcrumb items={[{ label: "Changes" }]} />}
    >
      <main className="page">
        <div className="page-in">
          <NewChange />
          <BrowseStacks repos={repos} />
          <section className="grid gap-3">
            <h2 className="h2">Changes</h2>
            <ChangeList changes={changes.data} error={changes.error?.message ?? null} />
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function NewChange() {
  const [text, setText] = useState("");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const hint = inputHint(text);
  const [progress, setProgress] = useState<string | null>(null);
  // Editing the input, a new submit or leaving the page stops the request in
  // flight, so an abandoned one can't open its Change later.
  const request = useLatestRequest();
  const create = useMutation({
    mutationFn: (input: string) => {
      const signal = request.next();
      setProgress(null);
      return api.createChange(
        { input },
        {
          onProgress: (step) => {
            if (!signal.aborted) setProgress(step);
          },
          signal,
        },
      );
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(["change", detail.change.id], detail);
      queryClient.invalidateQueries({ queryKey: ["changes"] });
      navigate(`/changes/${detail.change.id}`);
    },
  });
  return (
    <section className="grid gap-3">
      <h1 className="h1">Review a stack</h1>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (hint?.ok) create.mutate(text.trim());
        }}
      >
        <input
          aria-label="PR or branch"
          aria-describedby="new-change-hint"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            request.stop();
            create.reset();
          }}
          placeholder="PR URL, owner/repo#123 or owner/repo:branch"
          spellCheck={false}
          className="field flex-1 font-mono text-[12.5px]"
        />
        <button type="submit" disabled={!hint?.ok || create.isPending} className="btn primary h-8">
          {create.isPending ? "Finding the stack…" : "Review"}
        </button>
      </form>
      <p
        id="new-change-hint"
        role={create.error ? "alert" : undefined}
        className={`-mt-1 min-h-5 text-[12px] ${create.error || hint?.ok === false ? "text-text" : "text-muted"}`}
      >
        {create.error
          ? create.error.message
          : create.isPending
            ? (progress ??
              "Reading the repo's PRs and fetching their branches. The first time for a repo takes longest.")
            : (hint?.text ?? "Strata finds the whole stack around it, merged PRs included.")}
      </p>
    </section>
  );
}

function BrowseStacks({ repos }: { repos: string[] }) {
  const [repo, setRepo] = useState("");
  const [, navigate] = useLocation();
  const valid = REPO.test(repo.trim());
  return (
    <section className="grid gap-3">
      <h2 className="h2">Browse a repo's stacks</h2>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) navigate(`/repos/${repo.trim()}`);
        }}
      >
        <input
          aria-label="Repository"
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          placeholder="owner/repo"
          spellCheck={false}
          className="field flex-1 font-mono text-[12.5px]"
        />
        <button type="submit" disabled={!valid} className="btn h-8">
          Show stacks
        </button>
      </form>
      {repos.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
          {repos.map((name) => (
            <Link key={name} href={`/repos/${name}`} className="lnk font-mono text-[12px]">
              {name}
            </Link>
          ))}
        </p>
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
}: {
  changes: ChangeSummary[] | undefined;
  error: string | null;
}) {
  if (error) return <p className="alert">{error}</p>;
  if (!changes) return null;
  if (changes.length === 0) {
    return (
      <div className="empty">
        No Changes yet. Give Strata a PR above, or pick a stack from a repo.
      </div>
    );
  }
  return (
    <ul className="list">
      {changes.map((change) => (
        <li key={change.id}>
          <Link href={`/changes/${change.id}`} className="lrow">
            <span className="min-w-0 flex-1 truncate font-medium">{change.title}</span>
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

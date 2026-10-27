import type { ChangeSummary, MeResponse, RunStatus } from "@strata/core/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { TopBar } from "../components/TopBar";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { inputHint } from "../lib/input";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Start a review from a PR or branch, browse a repo's stacks, or reopen a Change. */
export function ChangesPage({ me }: { me: MeResponse }) {
  const changes = useQuery({ queryKey: ["changes"], queryFn: api.changes });
  const repos = [...new Set((changes.data ?? []).map((change) => change.repo))];
  return (
    <div className="flex h-full flex-col">
      <TopBar me={me} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-8 p-6">
          <NewChange />
          <BrowseStacks repos={repos} />
          <section>
            <h2 className="mb-2 text-base font-semibold">Changes</h2>
            <ChangeList changes={changes.data} error={changes.error?.message ?? null} />
          </section>
        </div>
      </main>
    </div>
  );
}

function NewChange() {
  const [text, setText] = useState("");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const hint = inputHint(text);
  const [progress, setProgress] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (input: string) => {
      setProgress(null);
      return api.createChange({ input }, setProgress);
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(["change", detail.change.id], detail);
      queryClient.invalidateQueries({ queryKey: ["changes"] });
      navigate(`/changes/${detail.change.id}`);
    },
  });
  return (
    <section>
      <h1 className="mb-2 text-base font-semibold">Review a stack</h1>
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
            create.reset();
          }}
          placeholder="PR URL, owner/repo#123 or owner/repo:branch"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 font-mono outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!hint?.ok || create.isPending}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent disabled:opacity-50"
        >
          {create.isPending ? "Finding the stack…" : "Review"}
        </button>
      </form>
      <p
        id="new-change-hint"
        role={create.error ? "alert" : undefined}
        className={`mt-1.5 min-h-5 ${create.error || hint?.ok === false ? "text-closed" : "text-muted"}`}
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
    <section>
      <h2 className="mb-2 text-base font-semibold">Browse a repo's stacks</h2>
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
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 font-mono outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!valid}
          className="rounded-md border border-line bg-surface px-3 py-1.5 hover:bg-raised disabled:opacity-50"
        >
          Show stacks
        </button>
      </form>
      {repos.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-2 text-muted">
          {repos.map((name) => (
            <Link
              key={name}
              href={`/repos/${name}`}
              className="font-mono text-accent hover:underline"
            >
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
  done: "Ready",
  failed: "Failed",
};

function ChangeList({
  changes,
  error,
}: {
  changes: ChangeSummary[] | undefined;
  error: string | null;
}) {
  if (error) return <p className="text-closed">{error}</p>;
  if (!changes) return null;
  if (changes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-6 text-center text-muted">
        No Changes yet. Give Strata a PR above, or pick a stack from a repo.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {changes.map((change) => (
        <li key={change.id}>
          <Link
            href={`/changes/${change.id}`}
            className="flex items-baseline gap-3 px-3 py-2 hover:bg-raised"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{change.title}</span>
            <span className="shrink-0 font-mono text-muted">{change.input}</span>
            <span
              className={`shrink-0 ${change.status === "failed" ? "text-closed" : "text-muted"}`}
            >
              {change.status ? STATUS[change.status] : ""}
            </span>
            <span className="w-16 shrink-0 text-right text-muted">{ago(change.updatedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

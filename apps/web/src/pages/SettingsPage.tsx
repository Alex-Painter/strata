import type { MeResponse } from "@strata/core/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { api } from "../lib/api";

/** Settings for each repo that Strata searches. */
export function SettingsPage({ me }: { me: MeResponse }) {
  const assigned = useQuery({ queryKey: ["assigned"], queryFn: api.assigned });
  const repos = assigned.data?.repos ?? [];
  return (
    <AppShell
      me={me}
      navLabel="Strata"
      nav={<HomeNav current={null} page="settings" />}
      top={<Breadcrumb items={[{ label: "Settings" }]} />}
    >
      <main className="page">
        <div className="page-in gap-6">
          <h1 className="h1">Settings</h1>
          {assigned.error && <p className="alert">{assigned.error.message}</p>}
          {assigned.data && repos.length === 0 && (
            <div className="empty">Strata does not search a repo at this time.</div>
          )}
          {repos.map((repo) => (
            <section key={repo} className="grid gap-3" aria-label={repo}>
              <h2 className="h2 font-mono">{repo}</h2>
              <ClaudeSetting repo={repo} />
            </section>
          ))}
        </div>
      </main>
    </AppShell>
  );
}

/**
 * Whether Claude may read this repo's code. Off by default; it writes the
 * same setting as settings/<owner>/<name>.json in Strata's data folder.
 */
function ClaudeSetting({ repo }: { repo: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["repo-settings", repo],
    queryFn: () => api.repoSettings(repo),
  });
  const save = useMutation({
    mutationFn: (send: boolean) => api.setSendCode(repo, send),
    onSuccess: (next) => queryClient.setQueryData(["repo-settings", repo], next),
  });
  const data = settings.data;
  const error = settings.error?.message ?? save.error?.message ?? null;
  return (
    <div className="grid gap-0.5 text-[14px]">
      <label className="flex items-center gap-1.5 text-muted">
        <input
          type="checkbox"
          checked={data?.sendCodeToAnthropic ?? false}
          disabled={!data || save.isPending}
          onChange={(event) => save.mutate(event.target.checked)}
        />
        Send the code in {repo} to Claude
      </label>
      <span className="pl-5 text-[13px] text-faint">
        {data && !data.claudeAvailable
          ? "The server has no Anthropic API key. Thus this setting has no effect."
          : "Claude writes the summaries and puts unclear files in a layer. The setting applies to the next analysis."}
      </span>
      {error && <span className="alert">{error}</span>}
    </div>
  );
}

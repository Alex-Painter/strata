import type { ChangeDetail, ChangeReport, MeResponse } from "@strata/core/model";
import { summarizeStack } from "@strata/core/stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "wouter";
import { ChatPanel } from "../components/ChatPanel";
import { Navigator } from "../components/Navigator";
import { PaneArea, type RunView } from "../components/PaneArea";
import { TopBar } from "../components/TopBar";
import { api } from "../lib/api";

/**
 * The review workspace: every kind of context side by side, with chat beside
 * it. Left, the stack map as the navigation rail. Centre, the panes: the
 * whole stack by default, or one PR when it's chosen on the map. Right, chat
 * about whatever the reviewer highlights.
 */
export function WorkspacePage(
  props: { mode: "static"; report: ChangeReport } | { mode: "server"; me: MeResponse },
) {
  return props.mode === "static" ? (
    <StaticWorkspace report={props.report} />
  ) : (
    <ServerWorkspace me={props.me} />
  );
}

/** A CLI-written page: the embedded report, with the scope kept in memory. */
function StaticWorkspace({ report }: { report: ChangeReport }) {
  const [scope, setScope] = useState<number | null>(null);
  return <Workspace mode="static" report={report} run={null} scope={scope} onScope={setScope} />;
}

function ServerWorkspace({ me }: { me: MeResponse }) {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["change", id],
    queryFn: () => api.change(id),
    // Poll while a run is going, so its report appears without a reload.
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status;
      return status === "queued" || status === "running" ? 1000 : false;
    },
  });
  const pickPath = useMutation({
    mutationFn: (tip: number) => {
      const stack = detail.data?.report?.stack;
      if (!stack) throw new Error("No stack to pick from.");
      return api.createChange({ input: `${stack.repo}#${stack.root}`, leaf: tip });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["change", next.change.id], next);
      navigate(`/changes/${next.change.id}`);
    },
  });
  const runAgain = useMutation({
    mutationFn: () => api.runAgain(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["change", id] }),
  });

  const scope = Number(params.get("pr")) || null;
  const onScope = (pr: number | null) =>
    setParams(pr === null ? {} : { pr: String(pr) }, { replace: false });

  if (detail.error) {
    return (
      <Shell me={me} title="Change">
        <p className="p-6 text-muted">{detail.error.message}</p>
      </Shell>
    );
  }
  const data: ChangeDetail | undefined = detail.data;
  return (
    <Workspace
      mode="server"
      me={me}
      title={data?.change.title}
      report={data?.report ?? null}
      run={{
        info: data?.run ?? null,
        loading: detail.isPending,
        onRunAgain: () => runAgain.mutate(),
        rerunning: runAgain.isPending,
      }}
      scope={scope}
      onScope={onScope}
      onPickPath={(tip) => pickPath.mutate(tip)}
      pickingPath={pickPath.isPending ? (pickPath.variables ?? null) : null}
      pickError={pickPath.error?.message ?? null}
    />
  );
}

function Workspace({
  mode,
  me,
  title,
  report,
  run,
  scope,
  onScope,
  onPickPath,
  pickingPath = null,
  pickError = null,
}: {
  mode: "server" | "static";
  me?: MeResponse;
  title?: string | undefined;
  report: ChangeReport | null;
  run: RunView | null;
  scope: number | null;
  onScope: (pr: number | null) => void;
  onPickPath?: (tip: number) => void;
  pickingPath?: number | null;
  pickError?: string | null;
}) {
  const stack = report?.stack ?? null;
  const summary = useMemo(() => (stack ? summarizeStack(stack) : null), [stack]);
  // Only PRs in the stack can be a scope; anything else in the URL means the whole stack.
  const pr = scope !== null && stack?.nodes.some((node) => node.pr.number === scope) ? scope : null;
  return (
    <Shell me={me} title={report?.change.title ?? title ?? "Change"} repo={stack?.repo}>
      <Navigator report={report} summary={summary} scope={pr} onScope={onScope} />
      <PaneArea
        report={report}
        summary={summary}
        scope={pr}
        onScope={onScope}
        run={run}
        {...(onPickPath ? { onPickPath } : {})}
        pickingPath={pickingPath}
        pickError={pickError}
      />
      <ChatPanel mode={mode} />
    </Shell>
  );
}

function Shell({
  me,
  title,
  repo,
  children,
}: {
  me?: MeResponse | undefined;
  title: string;
  repo?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <TopBar {...(me ? { me } : {})}>
        {repo && <span className="shrink-0 text-muted">{repo}</span>}
        <span className="truncate font-medium">{title}</span>
      </TopBar>
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}

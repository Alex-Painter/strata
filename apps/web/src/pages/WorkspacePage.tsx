import {
  type ApproveResult,
  type ChangeDetail,
  type ChangeReport,
  LAYER_IDS,
  type LayerId,
  type MeResponse,
  type PrApproval,
} from "@strata/core/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useParams, useSearchParams } from "wouter";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { api } from "../lib/api";
import { useLatestRequest } from "../lib/latest-request";
import type { ApprovalsView } from "../workspace/Approve";
import type { Nav } from "../workspace/model";
import { Workspace } from "../workspace/Workspace";

/**
 * The review workspace for one Change: the server's, with where the reviewer
 * is kept in the URL (`?pr=N&layer=api`), or a CLI-written page's, with it
 * kept in memory.
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

function StaticWorkspace({ report }: { report: ChangeReport }) {
  const [nav, setNav] = useState<Nav>({ layer: null, pr: null });
  return <Workspace report={report} run={null} nav={nav} onNav={setNav} />;
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
  const request = useLatestRequest();
  const pickPath = useMutation({
    mutationFn: (tip: number) => {
      const stack = detail.data?.report?.stack;
      if (!stack) throw new Error("There is no stack to select from.");
      return api.createChange(
        { input: `${stack.repo}#${stack.root}`, leaf: tip },
        { signal: request.next() },
      );
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

  const approvals = useApprovals(id, detail.data?.report?.analysis.startedAt ?? null);

  const layer = params.get("layer");
  const nav: Nav = {
    pr: Number(params.get("pr")) || null,
    layer: LAYER_IDS.includes(layer as LayerId) ? (layer as LayerId) : null,
  };
  const onNav = (next: Nav) => {
    const search: Record<string, string> = {};
    if (next.pr !== null) search.pr = String(next.pr);
    if (next.layer !== null) search.layer = next.layer;
    setParams(search);
  };

  if (detail.error) {
    return (
      <AppShell
        me={me}
        navLabel="Change"
        nav={null}
        top={<Breadcrumb items={[{ label: "Changes", href: "/" }, { label: "Change" }]} />}
      >
        <p className="p-8 text-muted">{detail.error.message}</p>
      </AppShell>
    );
  }
  const data: ChangeDetail | undefined = detail.data;
  return (
    <Workspace
      me={me}
      title={data?.change.title}
      yours={data?.change.yours ?? []}
      prs={data?.change.prs ?? []}
      pageNav={<HomeNav current={null} />}
      changeId={id}
      report={data?.report ?? null}
      run={{
        info: data?.run ?? null,
        loading: detail.isPending,
        onRunAgain: () => runAgain.mutate(),
        rerunning: runAgain.isPending,
      }}
      nav={nav}
      onNav={onNav}
      onPickPath={(tip) => pickPath.mutate(tip)}
      pickingPath={pickPath.isPending ? (pickPath.variables ?? null) : null}
      pickError={pickPath.error?.message ?? null}
      approvals={detail.data?.report?.stack ? approvals : undefined}
    />
  );
}

/**
 * Approvals for the Change's PRs. Strata reads them from GitHub when the
 * page opens and after each run, and sends an approval only from a confirmed
 * click.
 */
function useApprovals(id: string, analysedAt: string | null): ApprovalsView {
  const queryClient = useQueryClient();
  const key = ["approvals", id, analysedAt];
  const read = useQuery({
    queryKey: key,
    queryFn: () => api.approvals(id),
    enabled: analysedAt !== null,
    retry: false,
  });
  const [results, setResults] = useState<ApproveResult[]>([]);
  const send = useMutation({
    mutationFn: ({ prs, from }: { prs: PrApproval[]; from: "stack" | number }) =>
      api.approve(id, {
        prs: prs.map((pr) => ({ number: pr.number, headOid: pr.analysedHead ?? "" })),
        ...(from === "stack" ? { stack: true } : {}),
      }),
    onMutate: () => setResults([]),
    onSuccess: (body) => {
      setResults(body.results);
      queryClient.setQueryData(key, body.approvals);
      void queryClient.invalidateQueries({ queryKey: ["change", id] });
      void queryClient.invalidateQueries({ queryKey: ["changes"] });
    },
  });
  return {
    data: read.data ?? null,
    error: read.error ? read.error.message : null,
    sending: send.isPending ? (send.variables?.prs.map((pr) => pr.number) ?? []) : [],
    results,
    sendError:
      send.error && send.variables
        ? { from: send.variables.from, message: send.error.message }
        : null,
    approve: (prs, from) => send.mutate({ prs, from }),
  };
}

import {
  type ChangeDetail,
  type ChangeReport,
  LAYER_IDS,
  type LayerId,
  type MeResponse,
} from "@strata/core/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useParams, useSearchParams } from "wouter";
import { AppShell, Breadcrumb, HomeNav } from "../components/AppShell";
import { api } from "../lib/api";
import { useLatestRequest } from "../lib/latest-request";
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
    />
  );
}

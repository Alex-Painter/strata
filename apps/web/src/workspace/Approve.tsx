import {
  type ApprovalsResponse,
  type ApproveResult,
  approvalBlock,
  canApprove,
  type PrApproval,
  stackApproval,
} from "@strata/core/model";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";

/**
 * Approving PRs on GitHub from Strata. Every approval goes through a confirm
 * step, and only its second button sends it. Approvals go out as the signed-in
 * user and name the head commit Strata analysed.
 */
export interface ApprovalsView {
  data: ApprovalsResponse | null;
  /** Strata could not read the PRs from GitHub. */
  error: string | null;
  /** The PRs Strata is approving now. */
  sending: number[];
  /** What GitHub said to the last request, per PR. */
  results: ApproveResult[];
  /** Why Strata refused the last request, and where it started. */
  sendError: { from: "stack" | number; message: string } | null;
  approve: (prs: PrApproval[], from: "stack" | number) => void;
}

const short = (oid: string | null) => (oid ? oid.slice(0, 7) : "unknown");

/** The Approve action in a PR's pane, beside its status words. */
export function PrApprove({ approvals, pr: number }: { approvals: ApprovalsView; pr: number }) {
  const pr = approvals.data?.prs.find((p) => p.number === number);
  const [confirm, setConfirm] = useState<DOMRect | null>(null);
  if (!pr || !approvals.data) return null;
  const { state } = pr;
  const sending = approvals.sending.includes(number);
  const failed = approvals.results.find((r) => r.number === number && !r.ok);
  const refused = approvals.sendError?.from === number ? approvals.sendError.message : null;
  const note = failed && !failed.ok ? failed.error : refused;

  if (state.kind === "own" || state.kind === "closed") return null;
  if (state.kind === "approved") {
    return (
      <a href={state.url} target="_blank" rel="noreferrer" className="approved">
        <Icon name="check" className="i text-add" /> Approved by you
      </a>
    );
  }
  const block = approvalBlock(state, number);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {state.kind === "approved-earlier" && (
        <a href={state.url} target="_blank" rel="noreferrer" className="text-muted hover:text-text">
          You approved {short(state.commitOid)}
        </a>
      )}
      <button
        type="button"
        className="btn sm"
        disabled={!canApprove(state) || sending}
        title={block ?? `Approve #${number} on GitHub`}
        aria-haspopup="dialog"
        aria-expanded={confirm !== null}
        onClick={(event) => setConfirm(event.currentTarget.getBoundingClientRect())}
      >
        <Icon name="check" />
        {sending ? "Approving…" : state.kind === "approved-earlier" ? "Approve again" : "Approve"}
      </button>
      {state.kind === "head-moved" && <span className="text-muted">New commits since the run</span>}
      {note && (
        <span role="alert" className="text-del">
          {note}
        </span>
      )}
      {confirm && (
        <ConfirmApprove
          anchor={confirm}
          viewer={approvals.data.viewer}
          prs={[pr]}
          skip={[]}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            approvals.approve([pr], number);
          }}
        />
      )}
    </span>
  );
}

/** A PR row's mark in the stack graph: a check once you approved, else the Approve action on hover. */
export function RowApprove({
  approvals,
  pr: number,
  title,
}: {
  approvals: ApprovalsView;
  pr: number;
  title: string;
}) {
  const pr = approvals.data?.prs.find((p) => p.number === number);
  const [confirm, setConfirm] = useState<DOMRect | null>(null);
  if (!pr || !approvals.data) return null;
  if (pr.state.kind === "approved") {
    return (
      <span className="row-act approved" title="Approved by you">
        <Icon name="check" className="i text-add" />
        <span className="sr-only">Approved by you</span>
      </span>
    );
  }
  if (!canApprove(pr.state)) return null;
  const sending = approvals.sending.includes(number);
  return (
    <>
      <button
        type="button"
        className="row-act ib"
        aria-label={`Approve #${number} ${title}`}
        title={`Approve #${number} on GitHub`}
        aria-haspopup="dialog"
        aria-expanded={confirm !== null}
        data-open={confirm !== null || sending ? "true" : undefined}
        disabled={sending}
        onClick={(event) => setConfirm(event.currentTarget.getBoundingClientRect())}
      >
        {sending ? <span className="text-[12px]">…</span> : <Icon name="check" />}
      </button>
      {confirm && (
        <ConfirmApprove
          anchor={confirm}
          viewer={approvals.data.viewer}
          prs={[pr]}
          skip={[]}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            approvals.approve([pr], number);
          }}
        />
      )}
    </>
  );
}

/** Approve stack: every PR on the path that you can approve, in one confirm step. */
export function ApproveStack({ approvals }: { approvals: ApprovalsView }) {
  const [confirm, setConfirm] = useState<DOMRect | null>(null);
  if (!approvals.data) {
    return approvals.error ? (
      <p className="px-2 text-[13px] text-faint">{approvals.error}</p>
    ) : null;
  }
  const { approve, skip, blocked } = stackApproval(approvals.data.prs);
  const prs = approvals.data.prs.filter((pr) => approve.includes(pr.number));
  const sending = approvals.sending.length > 0;
  const title =
    blocked.length > 0
      ? `${blocked.map((n) => `#${n}`).join(", ")} has new commits. Run Strata again before you approve the stack.`
      : prs.length === 0
        ? "No PR on this path needs your approval."
        : `Approve ${prs.length === 1 ? "1 PR" : `${prs.length} PRs`} on GitHub`;
  const failures = approvals.results.filter((r) => !r.ok);
  const refused = approvals.sendError?.from === "stack" ? approvals.sendError.message : null;
  return (
    <div className="grid gap-1 px-2 pb-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn sm"
          disabled={blocked.length > 0 || prs.length === 0 || sending}
          title={title}
          aria-haspopup="dialog"
          aria-expanded={confirm !== null}
          onClick={(event) => setConfirm(event.currentTarget.getBoundingClientRect())}
        >
          <Icon name="check" />
          {sending ? "Approving…" : "Approve stack"}
        </button>
        {blocked.length > 0 && <span className="text-[13px] text-muted">New commits</span>}
      </div>
      {refused && (
        <p role="alert" className="text-[13px] text-del">
          {refused}
        </p>
      )}
      {failures.length > 1 &&
        failures.map(
          (r) =>
            !r.ok && (
              <p key={r.number} role="alert" className="text-[13px] text-del">
                {r.error}
              </p>
            ),
        )}
      {confirm && (
        <ConfirmApprove
          anchor={confirm}
          viewer={approvals.data.viewer}
          prs={prs}
          skip={skip}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            approvals.approve(prs, "stack");
          }}
        />
      )}
    </div>
  );
}

/**
 * The confirm step. It names each PR and the commit its approval names, and
 * the PRs it skips. Cancel has the focus, so Enter does not approve by itself.
 */
export function ConfirmApprove({
  anchor,
  viewer,
  prs,
  skip,
  onConfirm,
  onCancel,
}: {
  anchor: DOMRect;
  viewer: string;
  prs: PrApproval[];
  skip: { number: number; reason: string }[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-cancel]")?.focus();
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onCancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [onCancel]);
  const width = 320;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  // Under the button, or above it when it does not fit below.
  const [top, setTop] = useState(anchor.bottom + 6);
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 6;
    setTop(below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - 6 - height) : below);
  }, [anchor]);
  const heading =
    prs.length === 1
      ? `Approve #${prs[0]?.number} on GitHub?`
      : `Approve ${prs.length} PRs on GitHub?`;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={heading}
      className="pop fixed grid gap-2 p-3 text-[13px]"
      style={{ top, left, width }}
    >
      <p className="font-medium text-text">{heading}</p>
      <p className="text-muted">
        Strata sends an approval as <span className="font-mono">{viewer}</span>. The author and the
        team see it on GitHub.
      </p>
      <ul className="grid gap-0.5">
        {prs.map((pr) => (
          <li key={pr.number} className="font-mono">
            #{pr.number} <span className="text-faint">at {short(pr.analysedHead)}</span>
          </li>
        ))}
      </ul>
      {skip.length > 0 && (
        <div className="grid gap-0.5 text-muted">
          <p>Strata does not approve these PRs:</p>
          <ul className="grid gap-0.5">
            {skip.map((s) => (
              <li key={s.number}>
                <span className="font-mono">#{s.number}</span> {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn sm ghost" data-cancel onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn sm primary" onClick={onConfirm}>
          Approve on GitHub
        </button>
      </div>
    </div>
  );
}

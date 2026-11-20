import {
  type ApprovalsResponse,
  type ApproveResult,
  approvalBlock,
  canApprove,
  type PrApproval,
  stackApproval,
} from "@strata/core/model";
import { Icon } from "../components/Icon";
import { Spinner } from "../components/Spinner";

/**
 * Approving PRs on GitHub from Strata. A click sends the approval straight
 * away, and the button shows a spinner until GitHub answers. Approvals go out
 * as the signed-in user and name the head commit Strata analysed.
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
  /** Takes the PRs as GitHub shows them after a review sent from the review box. */
  update?: (next: ApprovalsResponse) => void;
}

const short = (oid: string | null) => (oid ? oid.slice(0, 7) : "unknown");

/** The Approve action in a PR's pane, beside its status words. */
export function PrApprove({ approvals, pr: number }: { approvals: ApprovalsView; pr: number }) {
  const pr = approvals.data?.prs.find((p) => p.number === number);
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
        aria-busy={sending || undefined}
        onClick={() => approvals.approve([pr], number)}
      >
        {sending ? <Spinner /> : <Icon name="check" />}
        {sending ? "Approving…" : state.kind === "approved-earlier" ? "Approve again" : "Approve"}
      </button>
      {state.kind === "head-moved" && <span className="text-muted">New commits since the run</span>}
      {note && (
        <span role="alert" className="text-del">
          {note}
        </span>
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
    <button
      type="button"
      className="row-act ib"
      aria-label={`Approve #${number} ${title}`}
      title={sending ? `Approving #${number}…` : `Approve #${number} on GitHub`}
      aria-busy={sending || undefined}
      data-open={sending ? "true" : undefined}
      disabled={sending}
      onClick={() => approvals.approve([pr], number)}
    >
      {sending ? <Spinner /> : <Icon name="check" />}
    </button>
  );
}

/** Approve stack: every PR on the path that you can approve, in one click. */
export function ApproveStack({ approvals }: { approvals: ApprovalsView }) {
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
        : [
            `Approve ${prs.map((pr) => `#${pr.number}`).join(", ")} on GitHub`,
            ...skip.map((s) => `Skips #${s.number}: ${s.reason}`),
          ].join("\n");
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
          aria-busy={sending || undefined}
          onClick={() => approvals.approve(prs, "stack")}
        >
          {sending ? <Spinner /> : <Icon name="check" />}
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
    </div>
  );
}

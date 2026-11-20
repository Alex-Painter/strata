import {
  type ApprovalsResponse,
  type ReviewComment,
  type ReviewEvent,
  reviewActions,
} from "@strata/core/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Icon } from "../components/Icon";
import { Spinner } from "../components/Spinner";
import { api } from "../lib/api";
import type { ApprovalsView } from "./Approve";

/** The comments of a Change's pending reviews, shared by the review box and Ask. */
export function useComments(changeId: string) {
  return useQuery({
    queryKey: ["comments", changeId],
    queryFn: () => api.comments(changeId),
  });
}

export function whereOf(comment: Pick<ReviewComment, "path" | "line" | "side">): string {
  if (comment.path === null) return "On the PR";
  const name = comment.path.split("/").at(-1);
  return `${name}:${comment.line}${comment.side === "LEFT" ? " (old)" : ""}`;
}

const short = (oid: string | null) => (oid ? oid.slice(0, 7) : "unknown");

const BUTTONS: Array<{ event: ReviewEvent; label: string; icon: "comment" | "x" | "check" }> = [
  { event: "COMMENT", label: "Only comment", icon: "comment" },
  { event: "REQUEST_CHANGES", label: "Request changes", icon: "x" },
  { event: "APPROVE", label: "Approve", icon: "check" },
];

/**
 * The review box at the top of a PR's pane: a summary, the comments waiting
 * in the PR's review, and the three ways to send it. Nothing goes to GitHub
 * until the reviewer presses one of the buttons.
 */
export function ReviewBox({
  changeId,
  pr: number,
  approvals,
  onReviewed,
}: {
  changeId: string;
  pr: number;
  approvals: ApprovalsView;
  /** Gets the PRs as GitHub shows them after the review. */
  onReviewed?: (approvals: ApprovalsResponse) => void;
}) {
  const queryClient = useQueryClient();
  const comments = useComments(changeId);
  const [summary, setSummary] = useState("");
  const [sent, setSent] = useState<{ url: string; event: ReviewEvent } | null>(null);
  const pending = (comments.data ?? []).filter((c) => c.pr === number && c.state === "pending");
  const pr = approvals.data?.prs.find((p) => p.number === number);

  const submit = useMutation({
    mutationFn: (event: ReviewEvent) =>
      api.submitReview(changeId, {
        pr: number,
        headOid: pr?.analysedHead ?? "",
        event,
        body: summary,
        commentIds: pending.map((c) => c.id),
      }),
    onMutate: () => setSent(null),
    onSuccess: (body) => {
      setSummary("");
      setSent({ url: body.url, event: body.event });
      onReviewed?.(body.approvals);
      void queryClient.invalidateQueries({ queryKey: ["comments", changeId] });
    },
  });

  if (!pr) {
    return approvals.error ? <p className="text-[13px] text-faint">{approvals.error}</p> : null;
  }
  const actions = reviewActions(pr.state);
  const empty = summary.trim() === "" && pending.length === 0;
  const allowed = (event: ReviewEvent) =>
    event === "COMMENT"
      ? actions.comment && !empty
      : event === "REQUEST_CHANGES"
        ? actions.requestChanges && !empty
        : actions.approve;
  const sending = submit.isPending ? submit.variables : null;
  const { state } = pr;

  return (
    <section className="review-box" aria-label={`Review #${number}`}>
      <div className="review-top">
        <span className="chip">
          {pending.length === 0
            ? "No comments yet"
            : pending.length === 1
              ? "1 comment"
              : `${pending.length} comments`}
        </span>
        {state.kind === "approved" && (
          <a href={state.url} target="_blank" rel="noreferrer" className="approved">
            <Icon name="check" className="i text-add" /> Approved by you
          </a>
        )}
        {state.kind === "approved-earlier" && (
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted hover:text-text"
          >
            You approved {short(state.commitOid)}
          </a>
        )}
        {sent && (
          <a href={sent.url} target="_blank" rel="noreferrer" className="lnk">
            {sent.event === "APPROVE"
              ? "Approved on GitHub"
              : sent.event === "REQUEST_CHANGES"
                ? "Changes requested on GitHub"
                : "Review sent to GitHub"}
          </a>
        )}
      </div>
      <textarea
        className="review-summary"
        aria-label="Review summary"
        placeholder="Add review summary…"
        value={summary}
        disabled={!actions.comment}
        onChange={(event) => setSummary(event.target.value)}
      />
      {pending.length > 0 && (
        <ul className="review-comments">
          {pending.map((comment) => (
            <PendingComment key={comment.id} comment={comment} changeId={changeId} />
          ))}
        </ul>
      )}
      <div className="review-actions">
        {actions.note && <span className="review-note text-[13px] text-muted">{actions.note}</span>}
        {submit.error && (
          <span role="alert" className="text-[13px] text-del">
            {submit.error.message}
          </span>
        )}
        {BUTTONS.map(({ event, label, icon }) => (
          <button
            key={event}
            type="button"
            className="btn sm"
            disabled={!allowed(event) || sending !== null}
            aria-busy={sending === event || undefined}
            title={
              !allowed(event) && actions.note
                ? actions.note
                : event !== "APPROVE" && empty
                  ? "Write a summary or add a comment first."
                  : `${label} on #${number} on GitHub`
            }
            onClick={() => submit.mutate(event)}
          >
            {sending === event ? (
              <Spinner />
            ) : (
              <Icon
                name={icon}
                className={`i ${icon === "x" ? "text-del" : icon === "check" ? "text-add" : ""}`}
              />
            )}
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** One comment waiting in the review: where it goes, its text, and Edit and Remove. */
function PendingComment({ comment, changeId }: { comment: ReviewComment; changeId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["comments", changeId] });
  const save = useMutation({
    mutationFn: (body: string) => api.updateComment(comment.id, body),
    onSuccess: () => {
      setEditing(null);
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteComment(comment.id),
    onSuccess: () => void refresh(),
  });
  return (
    <li className="review-comment">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] text-muted" title={comment.path ?? undefined}>
          {whereOf(comment)}
        </span>
        {comment.messageId && <span className="text-[12px] text-faint">from Ask</span>}
        <span className="flex-1" />
        {editing === null && (
          <button type="button" className="btn ghost sm" onClick={() => setEditing(comment.body)}>
            Edit
          </button>
        )}
        <button
          type="button"
          className="ib"
          aria-label={`Remove the comment on ${whereOf(comment)}`}
          title="Remove"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Icon name="x" />
        </button>
      </div>
      {editing === null ? (
        <p className="whitespace-pre-wrap text-[13px]">{comment.body}</p>
      ) : (
        <div className="grid gap-1.5">
          <textarea
            className="review-summary"
            aria-label={`Edit the comment on ${whereOf(comment)}`}
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn sm"
              disabled={editing.trim() === "" || save.isPending}
              onClick={() => save.mutate(editing)}
            >
              Save
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {save.error && (
              <span role="alert" className="text-[13px] text-del">
                {save.error.message}
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

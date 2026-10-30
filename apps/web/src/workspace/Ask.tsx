import { type Anchor, anchorId, type ChangeReport, type ChatMessage } from "@strata/core/model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { findHunk } from "../components/Diff";
import { Icon } from "../components/Icon";
import { api } from "../lib/api";
import { Markdown } from "../lib/markdown";

/** A question on its way: what was asked, and the answer so far. */
interface Pending {
  text: string;
  anchors: Anchor[];
  answer: string;
  status: string | null;
  error: string | null;
}

/**
 * The Ask tab: threads about the Change, each a list of questions and
 * Claude's answers. A question carries the highlights selected on the canvas.
 * Citations in an answer open their hunk.
 */
export function Ask({
  changeId,
  report,
  anchors,
  onRemoveAnchor,
  onClearAnchors,
  onCite,
  focus = 0,
}: {
  changeId: string;
  report: ChangeReport | null;
  /** Highlights waiting to go with the next question. */
  anchors: Anchor[];
  onRemoveAnchor: (index: number) => void;
  onClearAnchors: () => void;
  /** Opens a hunk on the canvas. */
  onCite: (hunkId: string) => void;
  /** Goes up each time the reviewer chooses Ask on a selection: the question box then gets focus. */
  focus?: number;
}) {
  const queryClient = useQueryClient();
  const repo = report?.change.repo.kind === "github" ? report.change.repo : null;
  const repoName = repo ? `${repo.owner}/${repo.name}` : null;
  const settings = useQuery({
    queryKey: ["repo-settings", repoName],
    queryFn: () => api.repoSettings(repoName ?? ""),
    enabled: repoName !== null,
  });
  const threads = useQuery({
    queryKey: ["threads", changeId],
    queryFn: () => api.threads(changeId),
  });
  // Null is a new thread, made when its first question goes.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const threadId = picked === undefined ? (threads.data?.[0]?.id ?? null) : picked;
  const messages = useQuery({
    queryKey: ["messages", threadId],
    queryFn: () => api.messages(threadId ?? ""),
    enabled: threadId !== null,
  });
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const shown = threadId ? (messages.data ?? []) : [];

  // Keep the newest text in view while the answer streams in.
  const length = shown.length + (pending?.answer.length ?? 0);
  useEffect(() => {
    if (length > 0) end.current?.scrollIntoView?.({ block: "end" });
  }, [length]);
  useEffect(() => () => abort.current?.abort(), []);
  // After Ask on a selection, the reviewer can type the question at once.
  const gated = settings.data
    ? !settings.data.claudeAvailable || !settings.data.sendCodeToAnthropic
    : false;
  useEffect(() => {
    if (focus > 0 && !gated) box.current?.focus();
  }, [focus, gated]);

  const send = async () => {
    const question = text.trim();
    if (!question || pending) return;
    const asked = anchors;
    setPending({ text: question, anchors: asked, answer: "", status: null, error: null });
    setText("");
    onClearAnchors();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const id = threadId ?? (await api.createThread(changeId)).id;
      if (!threadId) setPicked(id);
      await api.ask(
        id,
        { text: question, anchors: asked },
        (event) =>
          setPending((now) => {
            if (!now) return now;
            if (event.type === "delta")
              return { ...now, answer: now.answer + event.text, status: null };
            if (event.type === "status") return { ...now, status: event.text };
            if (event.type === "error") return { ...now, error: event.message };
            return now;
          }),
        controller.signal,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", id] }),
        queryClient.invalidateQueries({ queryKey: ["threads", changeId] }),
      ]);
      setPending((now) => (now?.error ? now : null));
    } catch (error) {
      if (controller.signal.aborted) {
        setPending(null);
        return;
      }
      setPending((now) =>
        now ? { ...now, error: error instanceof Error ? error.message : String(error) } : now,
      );
    }
  };

  if (!report) return <p className="text-muted">Strata did not analyse this Change yet.</p>;
  if (settings.data && !settings.data.claudeAvailable) {
    return (
      <p className="text-muted">
        Strata does not have an Anthropic API key. Thus Claude cannot answer questions.
      </p>
    );
  }
  if (settings.data && !settings.data.sendCodeToAnthropic) {
    return (
      <p className="text-muted">
        Claude cannot read the code in {repoName}. To ask Claude, turn on the setting in{" "}
        <Link href="/settings" className="lnk">
          Settings
        </Link>
        .
      </p>
    );
  }

  const old = (message: ChatMessage) =>
    message.analysedAt !== null && message.analysedAt !== report.analysis.startedAt;
  const citeLabel = (id: string) => findHunk(report, id)?.path.split("/").at(-1) ?? "hunk";

  return (
    <div className="ask">
      <div className="ask-bar">
        {(threads.data?.length ?? 0) > 0 && (
          <select
            aria-label="Thread"
            className="ask-thread"
            value={threadId ?? ""}
            disabled={pending !== null}
            onChange={(event) => setPicked(event.target.value || null)}
          >
            {threadId === null && <option value="">New thread</option>}
            {threads.data?.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title || "Untitled thread"}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn ghost sm"
          disabled={pending !== null || threadId === null}
          onClick={() => setPicked(null)}
        >
          New thread
        </button>
      </div>

      <div className="ask-log" aria-live="polite">
        {shown.length === 0 && !pending && (
          <p className="text-muted">
            Ask Claude about this Change. To ask about a part of a diff, select the text, then
            select Ask.
          </p>
        )}
        {shown.map((message) =>
          message.role === "user" ? (
            <Question
              key={message.id}
              text={message.text}
              anchors={message.anchors}
              report={report}
              onCite={onCite}
            />
          ) : (
            <div key={message.id} className="ask-a">
              {old(message) && (
                <p className="sub">This answer is about an earlier analysis of the Change.</p>
              )}
              <Markdown text={message.text} onCite={onCite} citeLabel={citeLabel} />
            </div>
          ),
        )}
        {pending && (
          <>
            <Question
              text={pending.text}
              anchors={pending.anchors}
              report={report}
              onCite={onCite}
            />
            <div className="ask-a">
              {pending.answer && (
                <Markdown text={pending.answer} onCite={onCite} citeLabel={citeLabel} />
              )}
              {!pending.error && (
                <p className="sub" role="status">
                  {pending.status ?? (pending.answer ? "Writing…" : "Thinking…")}
                </p>
              )}
              {pending.error && (
                <p className="alert" role="alert">
                  {pending.error}
                </p>
              )}
            </div>
          </>
        )}
        <div ref={end} />
      </div>

      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {anchors.length > 0 && (
          <ul className="ask-chips" aria-label="Highlights">
            {anchors.map((anchor, i) => (
              <li key={anchorId(anchor)} className="ask-chip">
                <span className="truncate">{anchorLabel(report, anchor)}</span>
                <button
                  type="button"
                  className="ib"
                  aria-label="Remove the highlight"
                  onClick={() => onRemoveAnchor(i)}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={box}
          aria-label="Question"
          placeholder={
            anchors.length > 0 ? "Write a question about the highlight" : "Write a question"
          }
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center gap-2">
          <span className="sub flex-1">Enter sends. Shift+Enter adds a line.</span>
          {pending && !pending.error ? (
            <button type="button" className="btn ghost sm" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <>
              {pending?.error && (
                <button type="button" className="btn ghost sm" onClick={() => setPending(null)}>
                  Close
                </button>
              )}
              <button
                type="submit"
                className="btn primary sm"
                disabled={!text.trim() || pending !== null}
              >
                Send
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

function Question({
  text,
  anchors,
  report,
  onCite,
}: {
  text: string;
  anchors: Anchor[];
  report: ChangeReport;
  onCite: (hunkId: string) => void;
}) {
  return (
    <div className="ask-q">
      {anchors.map((anchor, i) => {
        const source = anchor.source;
        const hunkId = source.kind === "hunk" || source.kind === "pr-hunk" ? source.hunkId : null;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a message's highlights never move.
            key={i}
            type="button"
            className="ask-quote"
            disabled={!hunkId}
            onClick={() => hunkId && onCite(hunkId)}
          >
            <span className="block truncate text-muted">{anchorLabel(report, anchor)}</span>
            {anchor.quote && <code className="block truncate">{anchor.quote.exact}</code>}
          </button>
        );
      })}
      <p className="whitespace-pre-wrap">{text}</p>
    </div>
  );
}

/** Where a highlight is, for its chip: the file, and the PR when it is a PR's own diff. */
export function anchorLabel(report: ChangeReport, anchor: Anchor): string {
  const source = anchor.source;
  switch (source.kind) {
    case "hunk":
    case "pr-hunk": {
      const path = findHunk(report, source.hunkId)?.path ?? "A hunk";
      return source.kind === "pr-hunk" ? `${path} in #${source.pr}` : path;
    }
    case "file":
      return source.path;
    case "pr":
      return `#${source.number}`;
    default:
      return source.kind;
  }
}

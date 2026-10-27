import type {
  ChangeReport,
  GitHubDiffCheck,
  Hunk,
  PrPart,
  RunInfo,
  Stack,
  StackIssue,
  StackNode,
  StackSummary,
} from "@strata/core/model";
import { layerMatrix } from "@strata/core/stack";
import { type ReactNode, useMemo } from "react";
import {
  ago,
  CHECKS_LABEL,
  countPrs,
  formatDate,
  LINK_MEANING,
  linkLabel,
  needsRestack,
  REVIEW_LABEL,
} from "../lib/format";
import { commitUrl, shortOid } from "../lib/github";
import { originChips, revisedBy, revisionChips } from "../lib/provenance";
import { ClaimList } from "./Claims";
import { Files, fileAnchor } from "./Diff";
import { EvidenceList } from "./EvidenceList";
import { GuideView } from "./Guide";
import { LayerMatrixView } from "./LayerMatrix";
import { PathPicker } from "./PathPicker";
import { StateBadge } from "./PrStatus";

export interface RunView {
  info: RunInfo | null;
  loading: boolean;
  onRunAgain: () => void;
  rerunning: boolean;
}

/**
 * Where context is read: the whole stack and its diff, or one PR of it ("How
 * it arrived") with that PR's own diff. A commit range has no PRs, so it's
 * just its diff, read the same way as a whole stack.
 */
export function PaneArea({
  report,
  summary,
  scope,
  onScope,
  run,
  onPickPath,
  pickingPath,
  pickError,
}: {
  report: ChangeReport | null;
  summary: StackSummary | null;
  scope: number | null;
  onScope: (pr: number | null) => void;
  run: RunView | null;
  onPickPath?: (tip: number) => void;
  pickingPath: number | null;
  pickError: string | null;
}) {
  const stack = report?.stack ?? null;
  const node = scope === null ? null : stack?.nodes.find((n) => n.pr.number === scope);
  return (
    <main className="flex min-w-0 flex-1 overflow-hidden">
      <section className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 p-6">
          {run && <RunBanner run={run} hasReport={report !== null} />}
          {report && stack && summary ? (
            node ? (
              <PrPane
                stack={stack}
                node={node}
                part={report.parts.find((part) => part.pr === node.pr.number)}
                onScope={onScope}
              />
            ) : (
              <StackPane
                report={report}
                stack={stack}
                summary={summary}
                onScope={onScope}
                {...(onPickPath ? { onPickPath } : {})}
                pickingPath={pickingPath}
                pickError={pickError}
              />
            )
          ) : report ? (
            <RangePane report={report} />
          ) : (
            !run && (
              <p className="text-muted">Nothing to show yet: this Change hasn't been analysed.</p>
            )
          )}
        </div>
      </section>
    </main>
  );
}

function RunBanner({ run, hasReport }: { run: RunView; hasReport: boolean }) {
  const { info } = run;
  if (run.loading) return <p className="text-muted">Loading the Change…</p>;
  if (!info) return null;
  if (info.status === "queued" || info.status === "running") {
    const step =
      info.status === "queued"
        ? "waiting for another run to finish"
        : (info.progress ?? "analysing").toLowerCase();
    // With a report on screen, a run is a refresh of it.
    const text = hasReport ? `Refreshing: ${step}` : step.charAt(0).toUpperCase() + step.slice(1);
    return (
      <p className="text-muted" role="status">
        {text}…
      </p>
    );
  }
  if (info.status === "done" && !hasReport) {
    return (
      <div role="status" className="rounded-md border border-dashed border-line px-3 py-2">
        <p>This Change was analysed by an older version of Strata. Run it again to see it.</p>
        <RunAgain run={run} />
      </div>
    );
  }
  if (info.status === "failed") {
    return (
      <div role="alert" className="rounded-md border border-closed/40 bg-del/40 px-3 py-2">
        <p>
          The last run failed{info.finishedAt ? ` ${ago(info.finishedAt)}` : ""}: {info.error}
        </p>
        {hasReport && <p className="text-muted">Showing the last report that worked.</p>}
        <RunAgain run={run} />
      </div>
    );
  }
  return null;
}

function RunAgain({ run }: { run: RunView }) {
  return (
    <button
      type="button"
      onClick={run.onRunAgain}
      disabled={run.rerunning}
      className="mt-2 rounded-md border border-line bg-surface px-2 py-1 hover:bg-raised"
    >
      Run again
    </button>
  );
}

function StackPane({
  report,
  stack,
  summary,
  onScope,
  onPickPath,
  pickingPath,
  pickError,
}: {
  report: ChangeReport;
  stack: Stack;
  summary: StackSummary;
  onScope: (pr: number | null) => void;
  onPickPath?: (tip: number) => void;
  pickingPath: number | null;
  pickError: string | null;
}) {
  const path = stack.selectedPath;
  const pathPrs = summary.prs.filter((pr) => path.includes(pr.number));
  const issues = stack.issues.filter((issue) => issue.prs.some((n) => path.includes(n)));
  const matrix = useMemo(() => layerMatrix(report), [report]);
  const chips = useMemo(() => originChips(report.parts), [report]);
  const hunks = useMemo(
    () => new Map(report.change.hunks.map((hunk) => [hunk.id, hunk])),
    [report],
  );
  const titles = new Map(stack.nodes.map((node) => [node.pr.number, node.pr.title]));
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-base font-semibold">{report.change.title}</h1>
        <p className="text-muted">
          {countPrs(pathPrs)} · on <span className="font-mono">{stack.trunk.name}</span>
          {stack.base && (
            <>
              , left at <CommitLink repo={stack.repo} oid={stack.base} />
            </>
          )}
        </p>
      </header>
      <PathPicker
        stack={summary}
        current={path}
        {...(onPickPath ? { onPick: onPickPath } : {})}
        pending={pickingPath}
      />
      {pickError && (
        <p role="alert" className="text-closed">
          {pickError}
        </p>
      )}
      <Issues repo={stack.repo} issues={issues} />
      <Notes notes={[...stack.notes, ...report.notes]} />
      {report.change.revisions && (
        <>
          <WholeSummary report={report} hunks={hunks} of="stack" />
          <LayerMatrixView
            matrix={matrix}
            titles={titles}
            onOpen={(pr, file) => {
              if (pr !== null) onScope(pr);
              showFile(file);
            }}
          />
          <Files
            files={report.change.files}
            hunks={report.change.hunks}
            chips={chips}
            onPr={onScope}
          />
        </>
      )}
    </>
  );
}

/** A commit range: its diff, with what's written about it, and no PRs. */
function RangePane({ report }: { report: ChangeReport }) {
  const hunks = useMemo(
    () => new Map(report.change.hunks.map((hunk) => [hunk.id, hunk])),
    [report],
  );
  const { repo, revisions } = report.change;
  const commit = (oid: string) =>
    repo.kind === "github" ? (
      <CommitLink repo={`${repo.owner}/${repo.name}`} oid={oid} />
    ) : (
      <span className="font-mono">{shortOid(oid)}</span>
    );
  return (
    <>
      <header className="space-y-1">
        <h1 className="text-base font-semibold">{report.change.title}</h1>
        {revisions && (
          <p className="text-muted">
            From {commit(revisions.base)}, where it branched, to {commit(revisions.head)}
          </p>
        )}
      </header>
      <Notes notes={report.notes} />
      {revisions && (
        <>
          <WholeSummary report={report} hunks={hunks} of="range" />
          <Files files={report.change.files} hunks={report.change.hunks} />
        </>
      )}
    </>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-md border border-dashed border-line px-3 py-2 text-muted">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

/** What's written about the whole diff: Claude's summary, then the Guide. */
function WholeSummary({
  report,
  hunks,
  of,
}: {
  report: ChangeReport;
  hunks: Map<string, Hunk>;
  of: "stack" | "range";
}) {
  return (
    <>
      {report.summary.length > 0 && (
        <section aria-labelledby="summary-heading" className="space-y-2">
          <h2 id="summary-heading" className="font-semibold">
            Summary
          </h2>
          <ClaimList claims={report.summary} hunks={hunks} onFile={showFile} />
          <p className="text-[11px] text-muted">
            Written by Claude from the {of === "stack" ? "whole-stack diff" : "range's diff"} alone.
            Each sentence opens the hunks it rests on.
          </p>
        </section>
      )}
      <GuideView
        guide={report.guide}
        files={report.change.files}
        hunks={hunks}
        onFile={showFile}
        of={of === "stack" ? "the whole stack" : "the range"}
      />
    </>
  );
}

/** Opens a file's diff and scrolls to it, once the pane showing it has rendered. */
function showFile(path: string) {
  setTimeout(() => {
    const element = document.getElementById(fileAnchor(path));
    if (element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView({ block: "start" });
  }, 0);
}

function PrPane({
  stack,
  node,
  part,
  onScope,
}: {
  stack: Stack;
  node: StackNode;
  part: PrPart | undefined;
  onScope: (pr: number | null) => void;
}) {
  const { pr } = node;
  const edge = stack.edges.find((e) => e.child === pr.number);
  // A restack issue says what the link below already shows, with the same evidence.
  const issues = stack.issues.filter(
    (issue) => issue.prs.includes(pr.number) && issue.kind !== "needs-restack",
  );
  const link = edge ? { link: edge.link, state: pr.state, baseRef: pr.baseRef } : null;
  const restack = link ? needsRestack(link) : false;
  const retarget =
    edge?.via === "retarget" ? pr.baseChanges.find((c) => c.from === edge.ref) : null;
  const lastPush = pr.forcePushes[pr.forcePushes.length - 1];
  return (
    <>
      <header className="space-y-1.5">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">How it arrived</p>
        <h1 className="flex items-baseline gap-2 text-base font-semibold">
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono font-normal text-muted hover:text-accent"
          >
            #{pr.number}
          </a>
          <span>{pr.title}</span>
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
          <StateBadge pr={pr} />
          {pr.review && <span>{REVIEW_LABEL[pr.review]}</span>}
          {pr.checks && <span>{CHECKS_LABEL[pr.checks]}</span>}
          {pr.author && <span>by {pr.author}</span>}
          <span>updated {ago(pr.updatedAt)}</span>
        </p>
      </header>

      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-3">
        <Fact term="Branch">
          <span className="font-mono">{pr.headRef}</span> into{" "}
          <span className="font-mono">{pr.baseRef}</span>
          {retarget && (
            <span className="text-muted">
              {" "}
              (retargeted from <span className="font-mono">{retarget.from}</span> on{" "}
              {formatDate(retarget.at)})
            </span>
          )}
        </Fact>
        {edge ? (
          <Fact term={`On #${edge.parent}`}>
            <p>
              <span className={restack ? "font-medium text-warn" : ""}>
                {(link && linkLabel(link, edge.parent)) ?? `Stacked on #${edge.parent}`}.
              </span>{" "}
              <span className="text-muted">{LINK_MEANING[edge.link]}</span>
            </p>
            <EvidenceList repo={stack.repo} evidence={edge.evidence} />
          </Fact>
        ) : (
          <Fact term="Bottom PR">
            Targets <span className="font-mono">{stack.trunk.name}</span>
            {stack.base && (
              <>
                , which it left at <CommitLink repo={stack.repo} oid={stack.base} />
              </>
            )}
            .
          </Fact>
        )}
        <Fact term="Its changes start">
          {node.anchor ? (
            <>
              after <CommitLink repo={stack.repo} oid={node.anchor} />
            </>
          ) : (
            <span className="text-muted">Unknown: git couldn't tell.</span>
          )}
        </Fact>
        {pr.state === "merged" && pr.mergedAt && (
          <Fact term="Merged">
            {formatDate(pr.mergedAt)}
            {pr.mergeCommitOid && (
              <>
                {" "}
                as <CommitLink repo={stack.repo} oid={pr.mergeCommitOid} />
              </>
            )}
          </Fact>
        )}
        {lastPush && (
          <Fact term="Force-pushed">
            {pr.forcePushes.length === 1 ? "Once" : `${pr.forcePushes.length} times`}, last on{" "}
            {formatDate(lastPush.at)}
          </Fact>
        )}
        {node.children.length > 0 && (
          <Fact term="Stacked on it">
            <span className="flex flex-wrap gap-2">
              {node.children.map((child) => (
                <button
                  key={child}
                  type="button"
                  onClick={() => onScope(child)}
                  className="font-mono text-accent hover:underline"
                >
                  #{child}
                </button>
              ))}
            </span>
          </Fact>
        )}
      </dl>
      <Issues repo={stack.repo} issues={issues} />
      {part && <PartDiff stack={stack} node={node} part={part} onScope={onScope} />}
    </>
  );
}

/** One PR's own diff, with how Strata built it and how it compares with GitHub's. */
function PartDiff({
  stack,
  node,
  part,
  onScope,
}: {
  stack: Stack;
  node: StackNode;
  part: PrPart;
  onScope: (pr: number | null) => void;
}) {
  const n = node.pr.number;
  const conflicted = stack.issues.some(
    (issue) => issue.kind === "replay-conflict" && issue.prs.includes(n),
  );
  const how =
    part.how === "replayed"
      ? "Strata put this PR's changes on the stack below it, as a restack would."
      : part.how === "apart"
        ? conflicted
          ? "Its changes conflict with the stack below it, so this is its diff from where its changes start to its head. It isn't in the whole-stack diff."
          : "A PR below it couldn't be put on the stack, so this is its diff from where its changes start to its head. It isn't in the whole-stack diff."
        : part.how === "unknown"
          ? "Git couldn't tell where its changes start, so there's no diff."
          : null;
  return (
    <>
      {part.github && !part.github.same && (
        <GitHubDiffers repo={stack.repo} pr={n} check={part.github} />
      )}
      {how && <p className="text-muted">{how}</p>}
      {part.summary.length > 0 && (
        <section aria-labelledby="part-summary-heading" className="space-y-2">
          <h2 id="part-summary-heading" className="font-semibold">
            What it changes
          </h2>
          <ClaimList
            claims={part.summary}
            hunks={new Map(part.hunks.map((hunk) => [hunk.id, hunk]))}
            onFile={showFile}
          />
          <p className="text-[11px] text-muted">Written by Claude from this PR's own diff.</p>
        </section>
      )}
      <RevisedLater part={part} path={stack.selectedPath} onScope={onScope} />
      {part.how !== "unknown" && (
        <Files files={part.files} hunks={part.hunks} chips={revisionChips(part)} onPr={onScope} />
      )}
    </>
  );
}

/** Says when later PRs changed this PR's lines again, which the hunk chips then mark. */
function RevisedLater({
  part,
  path,
  onScope,
}: {
  part: PrPart;
  path: number[];
  onScope: (pr: number | null) => void;
}) {
  const later = revisedBy(part, path);
  if (later.length === 0) return null;
  const total = later.reduce((sum, item) => sum + item.lines, 0);
  return (
    <p role="note" aria-label="Revised later">
      {total === 1 ? "1 line" : `${total} lines`} this PR added {total === 1 ? "was" : "were"}{" "}
      changed again later, in{" "}
      {later.map((item, i) => (
        <span key={item.pr}>
          {i > 0 && (i === later.length - 1 ? " and " : ", ")}
          <button
            type="button"
            onClick={() => onScope(item.pr)}
            className="font-mono text-accent hover:underline"
            title={item.lines === 1 ? "1 line" : `${item.lines} lines`}
          >
            #{item.pr}
          </button>
        </span>
      ))}
      .
    </p>
  );
}

function GitHubDiffers({ repo, pr, check }: { repo: string; pr: number; check: GitHubDiffCheck }) {
  return (
    <section
      aria-label="GitHub's diff"
      className="space-y-1 rounded-md border border-warn/40 bg-warn-bg px-3 py-2"
    >
      <p className="font-medium">GitHub's diff of #{pr} is different from this one.</p>
      {check.reason && <p>{check.reason}</p>}
      {check.onlyOnGitHub.length > 0 && (
        <PathList label="Only on GitHub" paths={check.onlyOnGitHub} />
      )}
      {check.onlyHere.length > 0 && <PathList label="Only here" paths={check.onlyHere} />}
      <EvidenceList repo={repo} evidence={check.evidence} />
    </section>
  );
}

function PathList({ label, paths }: { label: string; paths: string[] }) {
  return (
    <p>
      <span className="text-muted">{label}: </span>
      {paths.map((path, i) => (
        <span key={path}>
          {i > 0 && ", "}
          <span className="font-mono">{path}</span>
        </span>
      ))}
    </p>
  );
}

function Issues({ repo, issues }: { repo: string; issues: StackIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <section aria-label="Stack issues" className="space-y-2">
      {issues.map((issue) => (
        <div
          key={`${issue.kind} ${issue.prs.join(",")}`}
          className="rounded-md border border-warn/40 bg-warn-bg px-3 py-2"
        >
          <p>{issue.message}</p>
          <EvidenceList repo={repo} evidence={issue.evidence} />
        </div>
      ))}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function CommitLink({ repo, oid }: { repo: string; oid: string }) {
  return (
    <a
      href={commitUrl(repo, oid)}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-accent hover:underline"
    >
      {shortOid(oid)}
    </a>
  );
}

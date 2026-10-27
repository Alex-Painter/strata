import type {
  ChangeReport,
  Claim,
  GitHubDiffCheck,
  LayerId,
  PrPart,
  RunInfo,
  Stack,
  StackIssue,
  StackNode,
  StackSummary,
} from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import { layerMatrix } from "@strata/core/stack";
import { type ReactNode, useMemo } from "react";
import { ClaimList } from "../components/Claims";
import { Counts, meaningful } from "../components/Diff";
import { EvidenceList } from "../components/EvidenceList";
import { GuideView } from "../components/Guide";
import { Icon, LAYER_ICON } from "../components/Icon";
import { LayerMatrixView } from "../components/LayerMatrix";
import { PathPicker } from "../components/PathPicker";
import { StateBadge } from "../components/PrStatus";
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
import { revisedBy } from "../lib/provenance";
import { changeLayers, filesIn, plural, type ScopedDiff } from "./model";

export interface RunView {
  info: RunInfo | null;
  loading: boolean;
  onRunAgain: () => void;
  rerunning: boolean;
}

/** What the overview needs from the workspace. */
export interface OverviewProps {
  report: ChangeReport;
  diff: ScopedDiff;
  selected: Claim | null;
  onClaim: (claim: Claim) => void;
  /** Opens a file in its layer. */
  onFile: (path: string) => void;
  onLayer: (layer: LayerId) => void;
  onScope: (pr: number | null) => void;
  matrix: boolean;
}

/** Says what a run is doing, or why there's no report, above whatever's on the canvas. */
export function RunBanner({ run, hasReport }: { run: RunView; hasReport: boolean }) {
  const { info } = run;
  if (run.loading) return <p className="text-muted">Loading the Change…</p>;
  if (!info) return null;
  if (info.status === "queued" || info.status === "running") {
    const step =
      info.status === "queued"
        ? "Waiting for another run to finish"
        : (info.progress ?? "Analysing");
    // With a report on screen, a run is a refresh of it. Steps name repos and
    // products ("Reading PRs from GitHub"), so only a plain first word is lowered.
    const text = hasReport
      ? `Refreshing: ${/^[A-Z][a-z]/.test(step) ? step.charAt(0).toLowerCase() + step.slice(1) : step}`
      : step;
    return (
      <p className="text-muted" role="status">
        {text}…
      </p>
    );
  }
  if (info.status === "done" && !hasReport) {
    return (
      <div role="status" className="note grid justify-items-start gap-2 text-text">
        <p>This Change was analysed by an older version of Strata. Run it again to see it.</p>
        <RunAgain run={run} />
      </div>
    );
  }
  if (info.status === "failed") {
    return (
      <div role="alert" className="alert grid justify-items-start gap-1">
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
    <button type="button" onClick={run.onRunAgain} disabled={run.rerunning} className="btn mt-1">
      Run again
    </button>
  );
}

/** The whole stack: where it sits, its issues, and what's written about its diff. */
export function StackOverview({
  stack,
  summary,
  onPickPath,
  pickingPath,
  pickError,
  ...props
}: OverviewProps & {
  stack: Stack;
  summary: StackSummary;
  onPickPath?: (tip: number) => void;
  pickingPath: number | null;
  pickError: string | null;
}) {
  const { report } = props;
  const path = stack.selectedPath;
  const pathPrs = summary.prs.filter((pr) => path.includes(pr.number));
  const issues = stack.issues.filter((issue) => issue.prs.some((n) => path.includes(n)));
  const matrix = useMemo(() => layerMatrix(report), [report]);
  const titles = new Map(stack.nodes.map((node) => [node.pr.number, node.pr.title]));
  return (
    <>
      <header className="grid gap-1">
        <h1 className="h1">{report.change.title}</h1>
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
        <p role="alert" className="alert">
          {pickError}
        </p>
      )}
      <Issues repo={stack.repo} issues={issues} />
      {report.change.revisions && (
        <>
          {props.matrix && (
            <LayerMatrixView
              matrix={matrix}
              titles={titles}
              onOpen={(pr, file) => {
                if (pr !== null) props.onScope(pr);
                props.onFile(file);
              }}
            />
          )}
          <WholeSummary {...props} of="stack" />
        </>
      )}
    </>
  );
}

/** A commit range: where it branched, and what's written about its diff. No PRs. */
export function RangeOverview(props: OverviewProps) {
  const { repo, revisions, title } = props.report.change;
  const commit = (oid: string) =>
    repo.kind === "github" ? (
      <CommitLink repo={`${repo.owner}/${repo.name}`} oid={oid} />
    ) : (
      <span className="font-mono">{shortOid(oid)}</span>
    );
  return (
    <>
      <header className="grid gap-1">
        <h1 className="h1">{title}</h1>
        {revisions && (
          <p className="text-muted">
            From {commit(revisions.base)}, where it branched, to {commit(revisions.head)}
          </p>
        )}
      </header>
      {revisions && <WholeSummary {...props} of="range" />}
    </>
  );
}

/** What's written about the whole diff: Claude's summary, the Guide, then the layers. */
function WholeSummary({
  report,
  diff,
  selected,
  onClaim,
  onFile,
  onLayer,
  of,
}: OverviewProps & { of: "stack" | "range" }) {
  return (
    <>
      {report.summary.length > 0 && (
        <section aria-labelledby="summary-heading" className="grid gap-2">
          <div className="grid gap-0.5">
            <h2 id="summary-heading" className="h2">
              Summary
            </h2>
            <p className="sub">
              Written by Claude from the {of === "stack" ? "whole-stack diff" : "range's diff"}{" "}
              alone. Each sentence names the hunks it rests on.
            </p>
          </div>
          <ClaimList
            claims={report.summary}
            hunks={diff.byId}
            selected={selected}
            onSelect={onClaim}
          />
        </section>
      )}
      <GuideView
        guide={report.guide}
        files={report.change.files}
        hunks={diff.byId}
        onFile={onFile}
        selected={selected}
        onClaim={onClaim}
        of={of === "stack" ? "the whole stack" : "the range"}
      />
      <LayerRows report={report} diff={diff} onLayer={onLayer} />
    </>
  );
}

/** The layers in review order, each opening its view: where to go next. */
function LayerRows({
  report,
  diff,
  onLayer,
}: {
  report: ChangeReport;
  diff: ScopedDiff;
  onLayer: (layer: LayerId) => void;
}) {
  const layers = changeLayers(report).filter((layer) => filesIn(diff, layer).length > 0);
  if (layers.length === 0) return null;
  return (
    <section aria-labelledby="layers-heading" className="grid gap-2">
      <h2 id="layers-heading" className="h2">
        Layers
      </h2>
      <ul className="list">
        {layers.map((layer) => {
          const files = filesIn(diff, layer);
          return (
            <li key={layer}>
              <button type="button" className="lrow w-full" onClick={() => onLayer(layer)}>
                <span className="text-muted">
                  <Icon name={LAYER_ICON[layer]} />
                </span>
                <span className="min-w-0 flex-1 truncate">{LAYERS[layer].title}</span>
                {LAYERS[layer].inspect && <span className="text-[12px] text-faint">Inspect</span>}
                <span className="text-[12px] text-faint">{plural(files.length, "file")}</span>
                <span className="w-24 text-right">
                  <LayerCount files={files} diff={diff} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LayerCount({ files, diff }: { files: ScopedDiff["files"]; diff: ScopedDiff }) {
  if (files.every((file) => file.mechanical)) {
    return <span className="text-[12px] text-faint">mechanical</span>;
  }
  return <Counts {...meaningful(files, diff.byId)} />;
}

/** One PR of the stack: how it arrived, and what its own diff does. */
export function PrOverview({
  stack,
  node,
  part,
  ...props
}: OverviewProps & { stack: Stack; node: StackNode; part: PrPart | undefined }) {
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
      <header className="grid gap-1.5">
        <p className="sub">How it arrived</p>
        <h1 className="h1 flex items-baseline gap-2">
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono font-normal text-faint hover:text-text"
          >
            #{pr.number}
          </a>
          <span>{pr.title}</span>
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <StateBadge pr={pr} />
          {pr.review && <span>{REVIEW_LABEL[pr.review]}</span>}
          {pr.checks && <span>{CHECKS_LABEL[pr.checks]}</span>}
          {pr.author && <span>by {pr.author}</span>}
          <span>updated {ago(pr.updatedAt)}</span>
        </p>
      </header>

      <dl className="props">
        <Fact term="Branch">
          <span className="font-mono text-[12px]">{pr.headRef}</span> into{" "}
          <span className="font-mono text-[12px]">{pr.baseRef}</span>
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
              <span className={restack ? "font-medium" : ""}>
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
        <Fact term="Changes start">
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
                  onClick={() => props.onScope(child)}
                  className="lnk font-mono"
                >
                  #{child}
                </button>
              ))}
            </span>
          </Fact>
        )}
      </dl>
      <Issues repo={stack.repo} issues={issues} />
      {part && <PartSummary stack={stack} part={part} {...props} />}
    </>
  );
}

/** One PR's own diff: how Strata built it, how it compares with GitHub's, and what it does. */
function PartSummary({ stack, part, ...props }: OverviewProps & { stack: Stack; part: PrPart }) {
  const n = part.pr;
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
        <section aria-labelledby="part-summary-heading" className="grid gap-2">
          <div className="grid gap-0.5">
            <h2 id="part-summary-heading" className="h2">
              What it changes
            </h2>
            <p className="sub">Written by Claude from this PR's own diff.</p>
          </div>
          <ClaimList
            claims={part.summary}
            hunks={props.diff.byId}
            selected={props.selected}
            onSelect={props.onClaim}
          />
        </section>
      )}
      <RevisedLater part={part} path={stack.selectedPath} onScope={props.onScope} />
      {part.how !== "unknown" && (
        <LayerRows report={props.report} diff={props.diff} onLayer={props.onLayer} />
      )}
    </>
  );
}

/** Says when later PRs changed this PR's lines again, which its seams then mark. */
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
            className="lnk font-mono"
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
    <section aria-label="GitHub's diff" className="note grid gap-1 text-text">
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
          <span className="font-mono text-[12px]">{path}</span>
        </span>
      ))}
    </p>
  );
}

function Issues({ repo, issues }: { repo: string; issues: StackIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <section aria-label="Stack issues" className="grid gap-2">
      {issues.map((issue) => (
        <div key={`${issue.kind} ${issue.prs.join(",")}`} className="note text-text">
          <p>{issue.message}</p>
          <EvidenceList repo={repo} evidence={issue.evidence} />
        </div>
      ))}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="prop">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function CommitLink({ repo, oid }: { repo: string; oid: string }) {
  return (
    <a href={commitUrl(repo, oid)} target="_blank" rel="noreferrer" className="lnk font-mono">
      {shortOid(oid)}
    </a>
  );
}

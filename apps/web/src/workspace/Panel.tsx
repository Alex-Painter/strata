import type {
  ChangeReport,
  FileChange,
  Hunk,
  PathPr,
  VerdictStatus,
  YourPr,
} from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import type { CSSProperties, ReactNode } from "react";
import { citedHunks } from "../components/Claims";
import { Counts, layerFact, meaningful } from "../components/Diff";
import { Icon } from "../components/Icon";
import { Info } from "../components/Info";
import { ago, countPrs, FILE_STATUS, stateLabel } from "../lib/format";
import { type ReviewStatusKind, reviewStatus } from "../lib/status";
import { citedIds, claimsIn, hunksOf, plural, type ScopedDiff, type Selection } from "./model";
import type { RunView } from "./Overview";
import { PaneHandle } from "./PaneHandle";

const PANEL_MIN = 280;
const PANEL_MAX = 1200;

/**
 * When Strata last analysed the Change, and a button to analyse it again,
 * for example after a change to the repo's settings.
 */
function RunAgainLine({ run }: { run: RunView | null }) {
  const status = run?.info?.status;
  if (!run || status === "queued" || status === "running") return null;
  return (
    <span className="mt-0.5 flex items-center gap-2 text-[13px] text-muted">
      {run.info?.finishedAt && <span>Analysed {ago(run.info.finishedAt)}</span>}
      <button type="button" className="lnk" disabled={run.rerunning} onClick={run.onRunAgain}>
        Run again
      </button>
    </span>
  );
}

export const VERDICT_LABEL: Record<VerdictStatus, string> = {
  blocked: "Blocked",
  "needs-review": "Needs review",
  ready: "Ready",
  incomplete: "Incomplete",
};

/** The status pill's word: the verdict when there is one, else what the run is doing. */
export function statusWord(report: ChangeReport | null, run: RunView | null): string {
  if (report?.verdict) return VERDICT_LABEL[report.verdict.status];
  const status = run?.info?.status;
  if (status === "queued") return "Queued";
  if (status === "running") return "Analysing";
  if (status === "failed" && !report) return "Run failed";
  return report ? "No verdict yet" : "Not analysed";
}

/**
 * The Change's details, at the top of the left pane: whatever is selected (a
 * file, a hunk or a sentence) with where it came from, or, with nothing
 * selected, the Change's status, stack and notes. Code never shows here: a
 * sentence's hunks open under it on the canvas, where they can be highlighted.
 */
export function Details({
  report,
  diff,
  run,
  yours = [],
  prs: fresh = [],
  selection,
  onReveal,
  onSelect,
  onScope,
}: {
  report: ChangeReport | null;
  diff: ScopedDiff | null;
  run: RunView | null;
  /** Your PRs on the path, from the assignment search. */
  yours?: YourPr[];
  /** The path's PRs from the last assignment search, when Strata has them. */
  prs?: PathPr[];
  selection: Selection;
  /** Shows a file or hunk on the canvas, in its layer. */
  onReveal: (selection: Selection) => void;
  onSelect: (selection: Selection) => void;
  onScope: (pr: number | null) => void;
}) {
  const titles = new Map(report?.stack?.nodes.map((node) => [node.pr.number, node.pr.title]));
  let body: ReactNode = null;
  if (report && diff && selection?.kind === "file") {
    const file = diff.byPath.get(selection.path);
    if (file) {
      body = (
        <FileDetails
          file={file}
          diff={diff}
          titles={titles}
          onReveal={onReveal}
          onScope={onScope}
        />
      );
    }
  } else if (report && diff && selection?.kind === "hunk") {
    const hunk = diff.byId.get(selection.id);
    if (hunk) {
      body = (
        <HunkDetails
          hunk={hunk}
          report={report}
          diff={diff}
          titles={titles}
          onReveal={onReveal}
          onSelect={onSelect}
          onScope={onScope}
        />
      );
    }
  } else if (diff && selection?.kind === "claim") {
    const cited = citedHunks(selection.claim, diff.byId);
    body = (
      <>
        <div className="grid gap-1">
          <h2 className="ot prose">{selection.claim.text}</h2>
          <p className="okind">
            From {selection.by} · {selection.claim.confidence} confidence
          </p>
        </div>
        <Section title="Evidence" count={cited.length}>
          <div className="grid">
            {cited.map((hunk) => (
              <button
                key={hunk.id}
                type="button"
                className="evrow"
                onClick={() => onReveal({ kind: "hunk", id: hunk.id })}
              >
                <span className="f">
                  {hunk.path}:{hunk.newStart}
                </span>
              </button>
            ))}
          </div>
          {cited.length < citedIds(selection.claim).length && (
            <p className="sub">
              {plural(citedIds(selection.claim).length - cited.length, "cited hunk")} are not in
              this diff.
            </p>
          )}
        </Section>
      </>
    );
  }
  return (
    <section aria-label="Details" className="details">
      {body ? (
        <>
          <button
            type="button"
            className="btn ghost sm justify-self-start"
            onClick={() => onSelect(null)}
          >
            <Icon name="chev" className="i rotate-180" />
            Show the Change
          </button>
          {body}
        </>
      ) : (
        <Overview report={report} diff={diff} run={run} yours={yours} fresh={fresh} />
      )}
    </section>
  );
}

/**
 * The side panel, on the right: the chat with Claude, and nothing else. Code
 * and details open in the canvas and the left pane, so that the reviewer can
 * highlight them and ask about them here.
 */
export function Panel({
  children,
  onClose,
  width = 400,
  onWidth,
}: {
  children: ReactNode;
  onClose: () => void;
  width?: number;
  /** Set to let the reviewer drag the panel's left edge. */
  onWidth?: (width: number) => void;
}) {
  return (
    <aside
      aria-label="Ask Claude"
      className="panel"
      style={{ "--panel-w": `${width}px` } as CSSProperties}
    >
      {onWidth && (
        <PaneHandle
          width={width}
          onWidth={onWidth}
          edge="left"
          min={PANEL_MIN}
          max={PANEL_MAX}
          label="Resize the chat"
        />
      )}
      <div className="ptabs">
        <h2 className="ptitle">Ask Claude</h2>
        <span className="flex-1" />
        <button type="button" className="ib" aria-label="Hide panel" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="insp">{children}</div>
    </aside>
  );
}

function Overview({
  report,
  diff,
  run,
  yours,
  fresh,
}: {
  report: ChangeReport | null;
  diff: ScopedDiff | null;
  run: RunView | null;
  yours: YourPr[];
  fresh: PathPr[];
}) {
  if (!report) {
    return (
      <p className="text-muted">{run?.loading ? "Loading…" : "There is no report at this time."}</p>
    );
  }
  const stack = report.stack;
  const path = stack?.selectedPath ?? [];
  const prs = stack?.nodes.filter((node) => path.includes(node.pr.number)) ?? [];
  const authors = [...new Set(prs.map((node) => node.pr.author).filter(Boolean))];
  const scoped = diff?.pr != null ? prs.find((node) => node.pr.number === diff.pr) : null;
  const notes = [...(stack?.notes ?? []), ...report.notes];
  const counts = diff ? meaningful(diff.files, diff.byId) : null;
  // Until Strata gives a verdict, the status is GitHub's, by the home page's rules.
  const onPath: PathPr[] = fresh.length > 0 ? fresh : prs.map(({ pr }) => pr);
  const titles = new Map(prs.map(({ pr }) => [pr.number, pr.title]));
  const github = report.verdict
    ? null
    : reviewStatus(onPath, {
        waiting: yours.some((pr) => pr.active && pr.reasons.some((r) => r.kind !== "reviewed")),
        reviewed: yours.some((pr) => pr.reasons.some((r) => r.kind === "reviewed")),
      });
  return (
    <>
      <Section title="Properties">
        <dl className="props">
          {github ? (
            <>
              <Prop term="Status">
                <span className="mark self-start" data-tone={STATUS_TONE[github.kind]}>
                  {github.label}
                </span>
                <PrMarks prs={onPath} lines={github.lines} titles={titles} />
              </Prop>
              <Prop term="Strata">
                <span title="Strata does not give a verdict at this time.">
                  {statusWord(report, run)}
                </span>
                <RunAgainLine run={run} />
              </Prop>
            </>
          ) : (
            <Prop term="Status">
              <span
                title={report.verdict?.headline ?? "Strata does not give a verdict at this time."}
              >
                {statusWord(report, run)}
              </span>
              <RunAgainLine run={run} />
            </Prop>
          )}
          {stack && (
            <Prop term="Stack">
              {countPrs(prs.map((node) => node.pr))}
              {authors.length > 0 && ` by ${authors.join(", ")}`} onto{" "}
              <span className="font-mono text-[13px]">{stack.trunk.name}</span>
            </Prop>
          )}
          {scoped && (
            <Prop term="Scope">
              <a href={scoped.pr.url} target="_blank" rel="noreferrer" className="lnk">
                #{scoped.pr.number}
              </a>{" "}
              {stateLabel(scoped.pr)}
            </Prop>
          )}
          {diff && counts && (
            <Prop term="Diff">
              {plural(diff.files.length, "file")} · <Counts {...counts} />
            </Prop>
          )}
        </dl>
      </Section>
      {notes.length > 0 && (
        <Section title="Notes" count={notes.length}>
          <ul className="grid gap-2 text-[13.5px] text-muted">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** How each status reads at a glance: its colour. */
const STATUS_TONE: Record<ReviewStatusKind, Tone> = {
  "needs-you": "accent",
  ready: "ok",
  "changes-requested": "bad",
  "checks-failed": "bad",
  "needs-review": "warn",
  reviewed: "mute",
  draft: "mute",
  merged: "mute",
  closed: "mute",
};

type Tone = "ok" | "warn" | "bad" | "accent" | "mute";

/** One row for each PR on the path: its review and its checks, each in its colour. */
function PrMarks({
  prs,
  lines,
  titles,
}: {
  prs: PathPr[];
  /** The same facts as sentences, for the hover text. */
  lines: string[];
  titles: Map<number, string>;
}) {
  return (
    <ul className="mt-1.5 grid gap-1" aria-label="Each PR">
      {prs.map((pr, i) => {
        const marks: Array<[Tone, string]> = [];
        if (pr.state !== "open") marks.push(["mute", pr.state === "merged" ? "Merged" : "Closed"]);
        else {
          // A draft does not wait for a review yet.
          if (pr.draft) marks.push(["mute", "Draft"]);
          else
            marks.push(
              pr.review === "approved"
                ? ["ok", "Approved"]
                : pr.review === "changes-requested"
                  ? ["bad", "Changes requested"]
                  : ["warn", "Needs review"],
            );
          if (pr.checks === "success") marks.push(["ok", "Checks pass"]);
          else if (pr.checks === "failure") marks.push(["bad", "Checks fail"]);
          else if (pr.checks === "pending") marks.push(["warn", "Checks running"]);
        }
        const title = titles.get(pr.number);
        return (
          <li
            key={pr.number}
            className="flex flex-wrap items-center gap-1.5"
            title={[title, lines[i]].filter(Boolean).join("\n")}
          >
            <span className="w-14 shrink-0 font-mono text-[13px] text-muted">#{pr.number}</span>
            {marks.map(([tone, label]) => (
              <span key={label} className="mark" data-tone={tone}>
                {label}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function FileDetails({
  file,
  diff,
  titles,
  onReveal,
  onScope,
}: {
  file: FileChange;
  diff: ScopedDiff;
  titles: Map<number, string>;
  onReveal: (selection: Selection) => void;
  onScope: (pr: number | null) => void;
}) {
  const hunks = hunksOf(file, diff);
  const prs = new Map<number, string[]>();
  for (const hunk of hunks) {
    for (const chip of diff.chips.get(hunk.id) ?? []) {
      prs.set(chip.pr, [...(prs.get(chip.pr) ?? []), chip.title]);
    }
  }
  return (
    <>
      <div className="grid gap-1">
        <h2 className="ot">{file.path}</h2>
        <p className="okind">
          {FILE_STATUS[file.status]} · {LAYERS[file.layer.layer].title}
        </p>
      </div>
      <Section title="Properties">
        <dl className="props">
          <Prop term="Layer">{layerFact(file)}</Prop>
          <Prop term="Lines">
            {file.binary ? (
              "Binary"
            ) : (
              <Counts additions={file.additions} deletions={file.deletions} />
            )}
          </Prop>
          {file.mechanical && <Prop term="Mechanical">{file.mechanical.reason}</Prop>}
          {file.oldPath && <Prop term="Was">{file.oldPath}</Prop>}
        </dl>
      </Section>
      <Provenance diff={diff} prs={prs} titles={titles} onScope={onScope} />
      {hunks.length > 0 && (
        <Section title="Hunks" count={hunks.length}>
          <div className="grid">
            {hunks.map((hunk) => (
              <button
                key={hunk.id}
                type="button"
                className="evrow"
                onClick={() => onReveal({ kind: "hunk", id: hunk.id })}
              >
                <span className="f">
                  @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}{" "}
                  {hunk.section}
                </span>
                {hunk.mechanical && <span className="text-faint">{hunk.mechanical.reason}</span>}
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function HunkDetails({
  hunk,
  report,
  diff,
  titles,
  onReveal,
  onSelect,
  onScope,
}: {
  hunk: Hunk;
  report: ChangeReport;
  diff: ScopedDiff;
  titles: Map<number, string>;
  onReveal: (selection: Selection) => void;
  onSelect: (selection: Selection) => void;
  onScope: (pr: number | null) => void;
}) {
  const adds = hunk.lines.filter((line) => line.kind === "add").length;
  const dels = hunk.lines.filter((line) => line.kind === "del").length;
  const prs = new Map<number, string[]>();
  for (const chip of diff.chips.get(hunk.id) ?? []) {
    prs.set(chip.pr, [...(prs.get(chip.pr) ?? []), chip.title]);
  }
  const part = report.parts.find((p) => p.pr === diff.pr) ?? null;
  const citing = claimsIn(report, part).filter(({ claim }) => citedIds(claim).includes(hunk.id));
  return (
    <>
      <div className="grid gap-1">
        <button
          type="button"
          className="ot text-left hover:underline"
          onClick={() => onReveal({ kind: "file", path: hunk.path })}
        >
          {hunk.path}
        </button>
        <p className="okind font-mono">
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} {hunk.section}
        </p>
      </div>
      <Section title="Properties">
        <dl className="props">
          <Prop term="Layer">
            {LAYERS[hunk.layer.layer].title}
            <span className="text-muted">: {hunk.layer.reason}</span>
          </Prop>
          <Prop term="Lines">
            <Counts additions={adds} deletions={dels} />
          </Prop>
          {hunk.mechanical && <Prop term="Mechanical">{hunk.mechanical.reason}</Prop>}
        </dl>
      </Section>
      <Provenance diff={diff} prs={prs} titles={titles} onScope={onScope} />
      {citing.length > 0 && (
        <Section title="Cited by" count={citing.length}>
          <div className="grid gap-1">
            {citing.map(({ claim, by }) => (
              <button
                key={claim.text}
                type="button"
                className="evrow min-h-0 py-1.5 text-[13.5px] leading-normal"
                onClick={() => onSelect({ kind: "claim", claim, by })}
              >
                {claim.text}
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** Where a file or hunk came from: the PRs whose lines it holds, or that changed them later. */
function Provenance({
  diff,
  prs,
  titles,
  onScope,
}: {
  diff: ScopedDiff;
  prs: Map<number, string[]>;
  titles: Map<number, string>;
  onScope: (pr: number | null) => void;
}) {
  if (prs.size === 0) return null;
  return (
    <Section
      title={diff.pr === null ? "Came from" : "Revised later in"}
      count={prs.size}
      info="Strata got this from git blame on its chain of commits."
    >
      <div className="grid">
        {[...prs.entries()].map(([pr, notes]) => (
          <button
            key={pr}
            type="button"
            className="evrow"
            title={notes.join("\n")}
            onClick={() => onScope(pr)}
          >
            <span className="w-12 shrink-0 font-mono text-faint">#{pr}</span>
            <span className="f font-sans text-text">{titles.get(pr) ?? ""}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function Section({
  title,
  count,
  info,
  children,
}: {
  title: string;
  count?: number;
  /** What the section is, shown on hover. */
  info?: string;
  children: ReactNode;
}) {
  return (
    <section className="sect-g">
      <h3 className="sh">
        {title}
        {count !== undefined && <span className="sn">{count}</span>}
        {info && <Info text={info} />}
      </h3>
      {children}
    </section>
  );
}

function Prop({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="prop">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

import type {
  Anchor,
  ChangeReport,
  Claim,
  LayerId,
  MeResponse,
  PathPr,
  YourPr,
} from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import { summarizeStack } from "@strata/core/stack";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, Breadcrumb } from "../components/AppShell";
import { Counts, meaningful } from "../components/Diff";
import { Icon, LAYER_ICON } from "../components/Icon";
import { selectionAnchor } from "../lib/selection";
import { useStored } from "../lib/stored";
import { toggleTheme } from "../lib/theme";
import { Ask } from "./Ask";
import { LayerView } from "./LayerView";
import {
  changeLayers,
  DEFAULT_DISPLAY,
  filesIn,
  type Nav,
  plural,
  type ScopedDiff,
  type Selection,
  scopedDiff,
  scopedNode,
} from "./model";
import { type Command, CommandMenu, DisplayPopover, Shortcuts } from "./Overlays";
import { PrOverview, RangeOverview, RunBanner, type RunView, StackOverview } from "./Overview";
import { PaneHandle } from "./PaneHandle";
import { Panel, type PanelTab, statusWord } from "./Panel";
import { StackRail } from "./StackRail";

/**
 * The review workspace, after the Cross-Section design. The sidebar chooses a
 * layer or a PR; the canvas shows the overview or one layer of the diff in
 * scope; the side panel shows whatever is selected there, with its evidence.
 * Secondary options live behind Display (V), and everything has a key.
 */
export function Workspace({
  me,
  title,
  report,
  run,
  nav,
  onNav,
  onPickPath,
  pickingPath = null,
  pickError = null,
  yours = [],
  prs = [],
  pageNav = null,
  changeId = null,
}: {
  me?: MeResponse | undefined;
  title?: string | undefined;
  /** Your PRs on this Change, from your GitHub assignments; marked in the PR list. */
  yours?: YourPr[];
  /** The app's own page links, for the sidebar. */
  pageNav?: ReactNode;
  /** The Change's id on the server, which chat needs. Null on the CLI's page. */
  changeId?: string | null;
  /** The path's PRs as the last assignment search saw them; fresher than the report's. */
  prs?: PathPr[];
  report: ChangeReport | null;
  run: RunView | null;
  nav: Nav;
  onNav: (nav: Nav) => void;
  onPickPath?: (tip: number) => void;
  pickingPath?: number | null;
  pickError?: string | null;
}) {
  const stack = report?.stack ?? null;
  const summary = useMemo(() => (stack ? summarizeStack(stack) : null), [stack]);
  // Only PRs on the path can be a scope; anything else means the whole stack.
  const node = report ? scopedNode(report, nav.pr) : null;
  const pr = node ? node.pr.number : null;
  const part = report?.parts.find((p) => p.pr === pr) ?? null;
  const diff = useMemo(() => (report ? scopedDiff(report, part) : null), [report, part]);
  const layers = useMemo(() => (report ? changeLayers(report) : []), [report]);
  const layer = nav.layer && layers.includes(nav.layer) ? nav.layer : null;

  const [selection, setSelection] = useState<Selection>(null);
  const [display, setDisplay] = useStored("strata-display", DEFAULT_DISPLAY);
  const [panel, setPanel] = useStored("strata-panel", true);
  const [paneWidth, setPaneWidth] = useStored("strata-change-pane", 320);
  const [paneOpen, setPaneOpen] = useStored("strata-change-pane-open", true);
  // The side panel has two widths: its usual one, and a wide one for showing
  // the hunks a sentence rests on, since code needs room. Dragging sets the one in use.
  const [panelWidth, setPanelWidth] = useStored("strata-panel-width", 360);
  const [panelWide, setPanelWide] = useStored("strata-panel-wide", 760);
  const [overlay, setOverlay] = useState<"cmdk" | "help" | null>(null);
  const [displayOpen, setDisplayOpen] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<PanelTab>("details");
  /** Highlights waiting to go with the next question. */
  const [asking, setAsking] = useState<Anchor[]>([]);
  /** The Ask button next to a text selection on a diff. */
  const [pop, setPop] = useState<{ anchor: Anchor; x: number; y: number } | null>(null);

  // A selection on a surface that can be highlighted shows the Ask button.
  useEffect(() => {
    if (!changeId) return;
    const check = () => {
      const selection = window.getSelection();
      const anchor = selectionAnchor(selection);
      if (!anchor || !selection) return setPop(null);
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setPop({
        anchor,
        x: Math.min(rect.right, window.innerWidth - 80),
        y: Math.min(rect.bottom + 6, window.innerHeight - 36),
      });
    };
    const hide = () => setPop(null);
    document.addEventListener("mouseup", check);
    document.addEventListener("keyup", check);
    const scroller = canvas.current;
    scroller?.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("mouseup", check);
      document.removeEventListener("keyup", check);
      scroller?.removeEventListener("scroll", hide);
    };
  }, [changeId]);

  const go = useCallback(
    (next: Partial<Nav>, select: Selection = null) => {
      onNav({ layer, pr, ...next });
      setSelection(select);
    },
    [onNav, layer, pr],
  );
  const scope = useCallback((to: number | null) => go({ pr: to }), [go]);
  /** Shows a file or hunk in its layer, in this scope or another PR's, and selects it. */
  const reveal = useCallback(
    (target: Selection, to: number | null = pr) => {
      if (!report || !diff || !target || target.kind === "claim") return setSelection(target);
      const where =
        to === pr ? diff : scopedDiff(report, report.parts.find((p) => p.pr === to) ?? null);
      const path = target.kind === "file" ? target.path : where.byId.get(target.id)?.path;
      const file = path ? where.byPath.get(path) : undefined;
      if (file) go({ layer: file.layer.layer, pr: to }, target);
    },
    [report, diff, pr, go],
  );

  /** Opens a cited hunk: in the whole stack when it is there, else in its PR. */
  const cite = useCallback(
    (id: string) => {
      if (!report) return;
      if (report.change.hunks.some((hunk) => hunk.id === id)) {
        return reveal({ kind: "hunk", id }, null);
      }
      const owner = report.parts.find((part) => part.hunks.some((hunk) => hunk.id === id));
      if (owner) reveal({ kind: "hunk", id }, owner.pr);
    },
    [report, reveal],
  );

  // Keep the selection in view, wherever it was chosen from.
  useEffect(() => {
    if (!selection || selection.kind === "claim") return;
    const key = selection.kind === "file" ? `file:${selection.path}` : `hunk:${selection.id}`;
    canvas.current
      ?.querySelector(`[data-nav="${CSS.escape(key)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selection]);

  const moveLayer = (step: 1 | -1) => {
    const stops: Array<LayerId | null> = [null, ...layers];
    const next = stops[Math.max(0, Math.min(stops.length - 1, stops.indexOf(layer) + step))];
    go({ layer: next ?? null });
  };
  /** J and K: the next or previous selectable thing on the canvas, in page order. */
  const moveItem = (step: 1 | -1) => {
    const items = [...(canvas.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? [])];
    if (items.length === 0) return;
    const at = items.findIndex(
      (item) =>
        item.getAttribute("aria-current") === "true" ||
        item.getAttribute("aria-pressed") === "true",
    );
    const next = items[at === -1 ? (step === 1 ? 0 : items.length - 1) : at + step];
    if (!next) return;
    next.click();
    next.focus({ preventScroll: true });
    next.scrollIntoView?.({ block: "nearest" });
  };

  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    const key = event.key;
    if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "k") {
      event.preventDefault();
      setOverlay((open) => (open === "cmdk" ? null : "cmdk"));
      return;
    }
    if (overlay) {
      if (key === "Escape" || (overlay === "help" && key === "?")) {
        event.preventDefault();
        setOverlay(null);
      }
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    let handled = true;
    switch (key) {
      case "?":
        setOverlay("help");
        break;
      case "j":
        moveItem(1);
        break;
      case "k":
        moveItem(-1);
        break;
      case "ArrowDown":
      case "]":
        moveLayer(1);
        break;
      case "ArrowUp":
      case "[":
        moveLayer(-1);
        break;
      case "o":
        go({ layer: null });
        break;
      case "v":
        setDisplayOpen((open) => !open);
        break;
      case "s":
        setDisplay({ ...display, seams: !display.seams });
        break;
      case "m":
        if (stack) setDisplay({ ...display, matrix: !display.matrix });
        break;
      case "\\":
        setPanel(!panel);
        break;
      case "Escape":
        if (displayOpen) setDisplayOpen(false);
        else if (selection) setSelection(null);
        else if (pr !== null) scope(null);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const commands = useMemo<Command[]>(() => {
    if (!report || !diff) return [];
    const list: Command[] = [
      {
        id: "overview",
        group: "Go to",
        label: stack ? "Whole stack" : "Overview",
        icon: "review",
        hint: "O",
        run: () => go({ layer: null, pr: null }),
      },
      ...layers.map(
        (id): Command => ({
          id: `layer:${id}`,
          group: "Layers",
          label: LAYERS[id].title,
          icon: LAYER_ICON[id],
          hint: plural(filesIn(diff, id).length, "file"),
          run: () => go({ layer: id }),
        }),
      ),
      ...(stack?.selectedPath ?? []).map((n): Command => {
        const title = stack?.nodes.find((x) => x.pr.number === n)?.pr.title ?? "";
        return {
          id: `pr:${n}`,
          group: "Pull requests",
          label: `#${n} ${title}`,
          icon: "pr",
          run: () => go({ pr: n }),
        };
      }),
      ...diff.files.map(
        (file): Command => ({
          id: `file:${file.path}`,
          group: "Files",
          label: file.path,
          icon: "file",
          hint: LAYERS[file.layer.layer].title,
          run: () => reveal({ kind: "file", path: file.path }),
        }),
      ),
      {
        id: "seams",
        group: "Display",
        label: display.seams ? "Hide PR seams" : "Show PR seams",
        icon: "sliders",
        hint: "S",
        run: () => setDisplay({ ...display, seams: !display.seams }),
      },
      {
        id: "fold",
        group: "Display",
        label: display.fold ? "Unfold mechanical files" : "Fold mechanical files",
        icon: "sliders",
        run: () => setDisplay({ ...display, fold: !display.fold }),
      },
      {
        id: "panel",
        group: "Display",
        label: panel ? "Hide the side panel" : "Show the side panel",
        icon: "panel",
        hint: "\\",
        run: () => setPanel(!panel),
      },
      { id: "theme", group: "Theme", label: "Switch theme", icon: "theme", run: toggleTheme },
    ];
    if (stack) {
      list.splice(list.length - 3, 0, {
        id: "matrix",
        group: "Display",
        label: display.matrix ? "Hide layers by PR" : "Show layers by PR",
        icon: "sliders",
        hint: "M",
        run: () => setDisplay({ ...display, matrix: !display.matrix }),
      });
    }
    return list;
  }, [report, diff, stack, layers, display, panel, go, reveal, setDisplay, setPanel]);

  const name = report?.change.title ?? title ?? "Change";
  const overviewProps = report &&
    diff && {
      report,
      diff,
      selected: selection?.kind === "claim" ? selection.claim : null,
      onClaim: (claim: Claim) =>
        setSelection({ kind: "claim", claim, by: claimSource(report, claim) }),
      onFile: (path: string, to?: number | null) => reveal({ kind: "file", path }, to),
      onLayer: (to: LayerId) => go({ layer: to }),
      onScope: scope,
      matrix: display.matrix && pr === null,
    };

  return (
    <AppShell
      me={me}
      navLabel="Strata"
      top={
        <>
          <Breadcrumb items={[...(me ? [{ label: "Changes", href: "/" }] : []), { label: name }]} />
          <span
            className="pill status ml-1.5"
            title={report?.verdict?.headline ?? "Strata does not give a verdict at this time."}
          >
            {statusWord(report, run)}
          </span>
        </>
      }
      tools={{
        side: (
          <button
            type="button"
            className="ib"
            aria-label="Command menu"
            title="Command menu  ⌘K"
            onClick={() => setOverlay("cmdk")}
          >
            <Icon name="search" />
          </button>
        ),
        top: (
          <>
            <button
              type="button"
              className="ib"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts  ?"
              onClick={() => setOverlay("help")}
            >
              <Icon name="help" />
            </button>
            <button
              type="button"
              className="ib"
              aria-label="Side panel"
              title="Side panel  \"
              aria-pressed={panel}
              onClick={() => setPanel(!panel)}
            >
              <Icon name="panel" />
            </button>
          </>
        ),
      }}
      nav={pageNav}
    >
      <div className="ws-body flex min-h-0 flex-1">
        {report && diff && !paneOpen && (
          <div className="hidden w-10 shrink-0 flex-col items-center border-r border-line py-2 md:flex">
            <button
              type="button"
              className="ib"
              aria-label="Expand the pane"
              title="Expand the pane"
              onClick={() => setPaneOpen(true)}
            >
              <Icon name="chev" />
            </button>
          </div>
        )}
        {report && diff && paneOpen && (
          <aside
            aria-label="Change"
            style={{ width: paneWidth }}
            className="relative hidden shrink-0 flex-col overflow-y-auto border-r border-line px-2 py-3 md:flex"
          >
            <PaneHandle width={paneWidth} onWidth={setPaneWidth} />
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                className="ib"
                aria-label="Collapse the pane"
                title="Collapse the pane"
                onClick={() => setPaneOpen(false)}
              >
                <Icon name="chev" className="i rotate-180" />
              </button>
            </div>
            <ChangeNav
              report={report}
              layers={layers}
              layer={layer}
              pr={pr}
              countIn={(id) => filesIn(diff, id).length}
              onNav={go}
            />
            {summary && stack && stack.selectedPath.length > 0 && (
              <div className="sec">
                <h2 className="sec-h">
                  <span className="flex-1">Pull requests</span>
                  <span className="sn">{summary.prs.length}</span>
                </h2>
                <StackRail
                  stack={summary}
                  path={stack.selectedPath}
                  pr={pr}
                  onScope={scope}
                  onPickPath={onPickPath}
                  pickingPath={pickingPath}
                  yours={yours}
                />
              </div>
            )}
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="vbar">
            <h2 className="vt">
              <Icon name={layer ? LAYER_ICON[layer] : "review"} />
              {layer
                ? LAYERS[layer].title
                : pr !== null
                  ? `#${pr}`
                  : stack
                    ? "Whole stack"
                    : "Overview"}
            </h2>
            {diff && <ViewCounts diff={diff} layer={layer} />}
            {layer && LAYERS[layer].inspect && (
              <span className="vm" title={LAYERS[layer].description}>
                Inspect closely
              </span>
            )}
            {pr !== null && <Chip label={`Only #${pr}`} onRemove={() => scope(null)} />}
            {display.seams && (
              <Chip label="PR seams" onRemove={() => setDisplay({ ...display, seams: false })} />
            )}
            {display.matrix && stack && pr === null && layer === null && (
              <Chip
                label="Layers by PR"
                onRemove={() => setDisplay({ ...display, matrix: false })}
              />
            )}
            {!display.fold && (
              <Chip
                label="Mechanical unfolded"
                onRemove={() => setDisplay({ ...display, fold: true })}
              />
            )}
            <span className="flex-1" />
            <div className="relative">
              <button
                type="button"
                className="btn ghost"
                aria-expanded={displayOpen}
                data-display-toggle
                onClick={() => setDisplayOpen((open) => !open)}
              >
                <Icon name="sliders" />
                Display
              </button>
              {displayOpen && (
                <DisplayPopover
                  display={display}
                  onChange={setDisplay}
                  onClose={() => setDisplayOpen(false)}
                  matrixAvailable={stack !== null}
                />
              )}
            </div>
          </div>
          <div ref={canvas} className="canvas">
            <div className="canvas-in">
              {run && <RunBanner run={run} hasReport={report !== null} />}
              {report && diff && overviewProps ? (
                layer ? (
                  <LayerView
                    report={report}
                    diff={diff}
                    part={part}
                    layer={layer}
                    display={display}
                    selection={selection}
                    onSelect={setSelection}
                    onFile={(path) => reveal({ kind: "file", path })}
                    onScope={scope}
                  />
                ) : node && stack ? (
                  <PrOverview
                    {...overviewProps}
                    onClaim={(claim) =>
                      setSelection({ kind: "claim", claim, by: `#${node.pr.number}'s own diff` })
                    }
                    stack={stack}
                    node={node}
                    part={part ?? undefined}
                  />
                ) : stack && summary ? (
                  <StackOverview
                    {...overviewProps}
                    stack={stack}
                    summary={summary}
                    pickError={pickError}
                  />
                ) : (
                  <RangeOverview {...overviewProps} />
                )
              ) : (
                !run && (
                  <p className="text-muted">
                    There is nothing to show. Strata did not analyse this Change.
                  </p>
                )
              )}
            </div>
          </div>
        </main>
        {panel && (
          <Panel
            report={report}
            diff={diff}
            run={run}
            yours={yours}
            prs={prs}
            selection={selection}
            onReveal={reveal}
            onSelect={setSelection}
            onScope={scope}
            onClose={() => setPanel(false)}
            tab={tab}
            onTab={setTab}
            {...(selection?.kind === "claim" && tab === "details"
              ? { width: panelWide, onWidth: setPanelWide }
              : { width: panelWidth, onWidth: setPanelWidth })}
            ask={
              changeId ? (
                <Ask
                  changeId={changeId}
                  report={report}
                  anchors={asking}
                  onRemoveAnchor={(index) => setAsking(asking.filter((_, i) => i !== index))}
                  onClearAnchors={() => setAsking([])}
                  onCite={cite}
                />
              ) : null
            }
          />
        )}
        {pop && (
          <button
            type="button"
            className="btn primary sm ask-pop"
            style={{ left: pop.x, top: pop.y }}
            aria-label="Ask Claude about the selection"
            // Keep the text selected while the button is pressed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setAsking((now) => [...now, pop.anchor].slice(-10));
              setTab("ask");
              setPanel(true);
              setPop(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            Ask
          </button>
        )}
      </div>
      {overlay === "cmdk" && <CommandMenu commands={commands} onClose={() => setOverlay(null)} />}
      {overlay === "help" && <Shortcuts onClose={() => setOverlay(null)} />}
    </AppShell>
  );
}

/** Where a whole-diff sentence was written from: the summary, or a Guide section. */
function claimSource(report: ChangeReport, claim: Claim): string {
  const section = report.guide.sections.find((s) => s.about.includes(claim));
  if (section) return `the Guide's “${section.title}”`;
  return report.stack ? "the whole-stack diff" : "the range's diff";
}

/** The Change's own navigation: the whole stack (or overview), then its layers. */
function ChangeNav({
  report,
  layers,
  layer,
  pr,
  countIn,
  onNav,
}: {
  report: ChangeReport;
  layers: LayerId[];
  layer: LayerId | null;
  pr: number | null;
  countIn: (layer: LayerId) => number;
  onNav: (nav: Partial<Nav>) => void;
}) {
  const stack = report.stack;
  return (
    <>
      <button
        type="button"
        className="nrow"
        aria-current={layer === null && pr === null ? "true" : undefined}
        onClick={() => onNav({ layer: null, pr: null })}
      >
        <Icon name="review" />
        <span className="nl">{stack ? "Whole stack" : "Overview"}</span>
      </button>
      {layers.length > 0 && (
        <div className="sec">
          <div className="sec-h">Layers</div>
          {layers.map((id) => {
            const count = countIn(id);
            return (
              <button
                key={id}
                type="button"
                className={`nrow ${count === 0 ? "faint" : ""}`}
                aria-current={layer === id ? "true" : undefined}
                title={LAYERS[id].description}
                data-layer={id}
                onClick={() => onNav({ layer: id })}
              >
                <Icon name={LAYER_ICON[id]} />
                <span className="nl">{LAYERS[id].title}</span>
                <span className="nm">{count}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function ViewCounts({ diff, layer }: { diff: ScopedDiff; layer: LayerId | null }) {
  const files = layer ? filesIn(diff, layer) : diff.files;
  if (files.length === 0) return null;
  return (
    <span className="vm flex items-center gap-2">
      {plural(files.length, "file")}
      <Counts {...meaningful(files, diff.byId)} />
    </span>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="fchip">
      {label}
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove}>
        <Icon name="x" className="i size-3" />
      </button>
    </span>
  );
}

import type { StackPrSummary, StackSummary } from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import {
  layoutStackMap,
  type PrLayerBar,
  type StackMapEdge,
  stackMermaid,
} from "@strata/core/stack";
import { useMemo, useState } from "react";
import { linkLabel, needsRestack } from "../lib/format";
import { commitUrl, shortOid } from "../lib/github";
import { ReviewMarks, StateBadge } from "./PrStatus";

const ROW = 52;
/** Rows are taller once each PR has a layer bar. */
const ROW_WITH_BAR = 64;
const LANE = 14;
const PAD = 11;

const x = (lane: number) => PAD + lane * LANE;
const y = (row: number, height: number) => row * height + height / 2;
/** Where a lane's line runs. */
export const laneX = x;
/** How wide the drawing is for this many lanes. */
export const gutterWidth = (lanes: number) => x(lanes - 1) + PAD + 4;

/**
 * The stack drawn the way it grew: the trunk at the bottom, each PR on its own
 * row above the one it targets, tips on top. Core decides where everything
 * sits (layoutStackMap); this only draws it. With `onSelect`, choosing a PR
 * scopes the page to it, so the map doubles as the navigation rail. With
 * `bars`, each PR shows its lines by layer, mechanical ones in grey.
 */
export function StackMap({
  stack,
  path,
  active = null,
  onSelect,
  bars,
}: {
  stack: StackSummary;
  /** The path in view. PRs off it are dimmed. */
  path?: number[];
  /** The PR the page is scoped to, if any. */
  active?: number | null;
  onSelect?: (pr: number) => void;
  /** Each PR's lines by layer, once its diff is analysed. */
  bars?: Map<number, PrLayerBar>;
}) {
  const layout = useMemo(() => layoutStackMap(stack), [stack]);
  const row = bars ? ROW_WITH_BAR : ROW;
  const widest = Math.max(1, ...[...(bars?.values() ?? [])].map((bar) => total(bar)));
  const prs = new Map(stack.prs.map((pr) => [pr.number, pr]));
  const onPath = (n: number) => !path || path.includes(n);
  const gutter = gutterWidth(layout.lanes);
  const height = (layout.trunkRow + 1) * row;

  return (
    <div className="relative" style={{ height }}>
      <svg
        aria-hidden="true"
        width={gutter}
        height={height}
        className="pointer-events-none absolute top-0 left-0"
      >
        {layout.edges.map((edge) => (
          <EdgeLine key={edge.child} edge={edge} dim={!onPath(edge.child)} row={row} />
        ))}
        {layout.nodes.map((node) => {
          return (
            <Dot
              key={node.pr}
              cx={x(node.lane)}
              cy={y(node.row, row)}
              active={node.pr === active}
              dim={!onPath(node.pr)}
            />
          );
        })}
        <rect
          x={x(0) - 4}
          y={y(layout.trunkRow, row) - 4}
          width={8}
          height={8}
          rx={2}
          className="fill-muted"
        />
      </svg>
      <ol aria-label="Stack map">
        {layout.nodes.map((node) => (
          <li
            key={node.pr}
            data-pr={node.pr}
            data-row={node.row}
            data-lane={node.lane}
            style={{ height: row, paddingLeft: gutter }}
          >
            <PrRow
              pr={prs.get(node.pr) as StackPrSummary}
              repo={stack.repo}
              active={node.pr === active}
              dim={!onPath(node.pr)}
              {...(onSelect ? { onSelect } : {})}
              {...(bars ? { bar: bars.get(node.pr) ?? null, widest } : {})}
            />
          </li>
        ))}
        <li
          data-trunk={stack.trunk}
          style={{ height: row, paddingLeft: gutter }}
          className="flex flex-col justify-center px-2 text-muted"
        >
          <span className="font-mono text-text">{stack.trunk}</span>
          {stack.base && (
            <span className="text-[12px]">
              left at{" "}
              <a
                href={commitUrl(stack.repo, stack.base)}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:text-text"
              >
                {shortOid(stack.base)}
              </a>
            </span>
          )}
        </li>
      </ol>
    </div>
  );
}

function PrRow({
  pr,
  repo,
  active,
  dim,
  onSelect,
  bar,
  widest = 1,
}: {
  pr: StackPrSummary;
  repo: string;
  active: boolean;
  dim: boolean;
  onSelect?: (pr: number) => void;
  /** Undefined when the map has no bars; null for a PR without one. */
  bar?: PrLayerBar | null;
  widest?: number;
}) {
  const link = linkLabel(pr, pr.parent);
  const restack = needsRestack(pr);
  return (
    <div
      className={`relative flex h-full min-w-0 flex-col justify-center gap-0.5 rounded-md px-2 ${
        active ? "bg-active" : onSelect ? "hover:bg-hover" : ""
      } ${dim ? "opacity-50" : ""}`}
    >
      {onSelect && (
        <button
          type="button"
          aria-label={`Show #${pr.number} ${pr.title}`}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect(pr.number)}
          className="absolute inset-0 rounded-md"
        />
      )}
      <div className="flex min-w-0 items-baseline gap-1.5">
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          title={`#${pr.number} on GitHub`}
          className="relative shrink-0 font-mono text-faint hover:text-text"
        >
          #{pr.number}
        </a>
        <span
          className={`truncate ${pr.state === "open" ? "font-medium" : "text-muted"}`}
          title={pr.title}
        >
          {pr.title}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
        <StateBadge pr={pr} />
        <ReviewMarks pr={pr} />
        {pr.state === "merged" && pr.mergeCommitOid && (
          <a
            href={commitUrl(repo, pr.mergeCommitOid)}
            target="_blank"
            rel="noreferrer"
            className="relative font-mono hover:text-text"
            title="The commit that GitHub merged"
          >
            as {shortOid(pr.mergeCommitOid)}
          </a>
        )}
        {link && <span className={`truncate ${restack ? "text-text" : ""}`}>{link}</span>}
      </div>
      {bar !== undefined && <LayerBar bar={bar} widest={widest} />}
    </div>
  );
}

/**
 * A PR's lines as a bar, as long as its share of the busiest PR's, split by
 * layer in review order, with mechanical lines in grey at the end.
 */
function LayerBar({ bar, widest }: { bar: PrLayerBar | null; widest: number }) {
  // PRs off the path, or with no diff, have no bar.
  if (!bar) return <div className="h-3" />;
  const all = total(bar);
  const summary = `${bar.meaningful} lines in ${bar.files === 1 ? "1 file" : `${bar.files} files`}${
    bar.mechanical > 0 ? `, plus ${bar.mechanical} mechanical` : ""
  }`;
  return (
    <div className="flex h-3 min-w-0 items-center gap-1.5" data-bar>
      <div
        role="img"
        aria-label={summary}
        title={summary}
        className="flex h-1 min-w-1 gap-[2px]"
        style={{ width: `${Math.max(4, (all / widest) * 100)}%` }}
      >
        {bar.segments.map((segment) => (
          <span
            key={segment.layer}
            title={`${LAYERS[segment.layer].title}: ${segment.lines} lines`}
            className="h-full rounded-full"
            style={{
              flexGrow: segment.lines,
              background: "var(--fg-3)",
            }}
            data-layer={segment.layer}
          />
        ))}
        {bar.mechanical > 0 && (
          <span
            title={`Mechanical: ${bar.mechanical} lines`}
            className="h-full rounded-full"
            style={{ flexGrow: bar.mechanical, background: "var(--line-2)" }}
            data-layer="mechanical"
          />
        )}
      </div>
      <span className="shrink-0 font-mono text-[11px] leading-3 text-muted">{bar.meaningful}</span>
    </div>
  );
}

const total = (bar: PrLayerBar) => bar.meaningful + bar.mechanical;

export function EdgeLine({ edge, dim, row }: { edge: StackMapEdge; dim: boolean; row: number }) {
  const fx = x(edge.from.lane);
  const fy = y(edge.from.row, row);
  const tx = x(edge.to.lane);
  const ty = y(edge.to.row, row);
  // Same lane: straight up. Otherwise turn into the child's lane within one row, then go straight up.
  const d =
    fx === tx
      ? `M${fx} ${fy}V${ty}`
      : `M${fx} ${fy}C${fx} ${fy - row * 0.55} ${tx} ${fy - row * 0.45} ${tx} ${fy - row}V${ty}`;
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeDasharray={
        edge.line === "dashed" ? "4 3" : edge.line === "dotted" ? "0.5 3.5" : undefined
      }
      className={edge.line === "solid" && !dim ? "stroke-muted" : "stroke-line-2"}
      data-edge={`${edge.parent ?? "trunk"}-${edge.child}`}
      data-line={edge.line}
    />
  );
}

export function Dot({
  cx,
  cy,
  active,
  dim,
}: {
  cx: number;
  cy: number;
  active: boolean;
  dim: boolean;
}) {
  // Every PR is the same node; its state is a word on its row, never a colour.
  return (
    <g opacity={dim ? 0.5 : 1}>
      {active && (
        <circle cx={cx} cy={cy} r={8} className="fill-none stroke-accent" strokeWidth={1.5} />
      )}
      <circle cx={cx} cy={cy} r={4} strokeWidth={1.5} className="fill-surface stroke-muted" />
    </g>
  );
}

/** Copies the map as a Mermaid flowchart, for pasting into a PR description or a doc. */
export function CopyMermaid({ stack }: { stack: StackSummary }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  return (
    <button
      type="button"
      className="btn ghost sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(stackMermaid(stack));
          setCopied("yes");
        } catch {
          setCopied("failed");
        }
        setTimeout(() => setCopied(null), 1500);
      }}
    >
      {copied === "yes" ? "Copied" : copied === "failed" ? "Cannot copy" : "Copy as Mermaid"}
    </button>
  );
}

import type { StackPrSummary, StackSummary } from "@strata/core/model";
import { layoutStackMap, type StackMapEdge, stackMermaid } from "@strata/core/stack";
import { useMemo, useState } from "react";
import { linkLabel } from "../lib/format";
import { commitUrl, shortOid } from "../lib/github";
import { ReviewMarks, StateBadge } from "./PrStatus";

const ROW = 52;
const LANE = 14;
const PAD = 11;

const x = (lane: number) => PAD + lane * LANE;
const y = (row: number) => row * ROW + ROW / 2;

/**
 * The stack drawn the way it grew: the trunk at the bottom, each PR on its own
 * row above the one it targets, tips on top. Core decides where everything
 * sits (layoutStackMap); this only draws it. With `onSelect`, choosing a PR
 * scopes the page to it, so the map doubles as the navigation rail.
 */
export function StackMap({
  stack,
  path,
  active = null,
  onSelect,
}: {
  stack: StackSummary;
  /** The path in view. PRs off it are dimmed. */
  path?: number[];
  /** The PR the page is scoped to, if any. */
  active?: number | null;
  onSelect?: (pr: number) => void;
}) {
  const layout = useMemo(() => layoutStackMap(stack), [stack]);
  const prs = new Map(stack.prs.map((pr) => [pr.number, pr]));
  const onPath = (n: number) => !path || path.includes(n);
  const gutter = x(layout.lanes - 1) + PAD + 4;
  const height = (layout.trunkRow + 1) * ROW;

  return (
    <div className="relative" style={{ height }}>
      <svg
        aria-hidden="true"
        width={gutter}
        height={height}
        className="pointer-events-none absolute top-0 left-0"
      >
        {layout.edges.map((edge) => (
          <EdgeLine key={edge.child} edge={edge} dim={!onPath(edge.child)} />
        ))}
        {layout.nodes.map((node) => {
          const pr = prs.get(node.pr) as StackPrSummary;
          return (
            <Dot
              key={node.pr}
              cx={x(node.lane)}
              cy={y(node.row)}
              pr={pr}
              active={node.pr === active}
              dim={!onPath(node.pr)}
            />
          );
        })}
        <rect
          x={x(0) - 4}
          y={y(layout.trunkRow) - 4}
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
            style={{ height: ROW, paddingLeft: gutter }}
          >
            <PrRow
              pr={prs.get(node.pr) as StackPrSummary}
              repo={stack.repo}
              active={node.pr === active}
              dim={!onPath(node.pr)}
              {...(onSelect ? { onSelect } : {})}
            />
          </li>
        ))}
        <li
          data-trunk={stack.trunk}
          style={{ height: ROW, paddingLeft: gutter }}
          className="flex flex-col justify-center px-2 text-muted"
        >
          <span className="font-mono text-text">{stack.trunk}</span>
          {stack.base && (
            <span className="text-[11px]">
              left at{" "}
              <a
                href={commitUrl(stack.repo, stack.base)}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:text-accent"
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
}: {
  pr: StackPrSummary;
  repo: string;
  active: boolean;
  dim: boolean;
  onSelect?: (pr: number) => void;
}) {
  const link = linkLabel(pr.link, pr.parent, pr.baseRef);
  const restack = pr.link === "behind" || pr.link === "stale";
  return (
    <div
      className={`relative flex h-full min-w-0 flex-col justify-center gap-0.5 rounded-md px-2 ${
        active ? "bg-raised ring-1 ring-accent/50" : onSelect ? "hover:bg-raised" : ""
      } ${dim ? "opacity-50" : ""}`}
    >
      {onSelect && (
        <button
          type="button"
          aria-label={`Show #${pr.number} ${pr.title}`}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect(pr.number)}
          className="absolute inset-0 rounded-md focus-visible:outline-2 focus-visible:outline-accent"
        />
      )}
      <div className="flex min-w-0 items-baseline gap-1.5">
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          title={`#${pr.number} on GitHub`}
          className="relative shrink-0 font-mono text-muted hover:text-accent"
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
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
        <StateBadge pr={pr} />
        <ReviewMarks pr={pr} />
        {pr.state === "merged" && pr.mergeCommitOid && (
          <a
            href={commitUrl(repo, pr.mergeCommitOid)}
            target="_blank"
            rel="noreferrer"
            className="relative font-mono hover:text-accent"
            title="The commit it landed as"
          >
            as {shortOid(pr.mergeCommitOid)}
          </a>
        )}
        {link && <span className={`truncate ${restack ? "text-warn" : ""}`}>{link}</span>}
      </div>
    </div>
  );
}

function EdgeLine({ edge, dim }: { edge: StackMapEdge; dim: boolean }) {
  const fx = x(edge.from.lane);
  const fy = y(edge.from.row);
  const tx = x(edge.to.lane);
  const ty = y(edge.to.row);
  // Same lane: straight up. Otherwise turn into the child's lane within one row, then go straight up.
  const d =
    fx === tx
      ? `M${fx} ${fy}V${ty}`
      : `M${fx} ${fy}C${fx} ${fy - ROW * 0.55} ${tx} ${fy - ROW * 0.45} ${tx} ${fy - ROW}V${ty}`;
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeDasharray={
        edge.line === "dashed" ? "4 3" : edge.line === "dotted" ? "0.5 3.5" : undefined
      }
      className={edge.line === "solid" ? (dim ? "stroke-line" : "stroke-muted") : "stroke-warn"}
      data-edge={`${edge.parent ?? "trunk"}-${edge.child}`}
      data-line={edge.line}
    />
  );
}

function Dot({
  cx,
  cy,
  pr,
  active,
  dim,
}: {
  cx: number;
  cy: number;
  pr: StackPrSummary;
  active: boolean;
  dim: boolean;
}) {
  // Open PRs are solid; drafts, landed and closed ones are rings, so the live work stands out.
  const look =
    pr.state === "merged"
      ? "stroke-merged fill-surface"
      : pr.state === "closed"
        ? "stroke-closed fill-surface"
        : pr.draft
          ? "stroke-muted fill-surface"
          : "stroke-open fill-open";
  return (
    <g opacity={dim ? 0.5 : 1}>
      {active && (
        <circle cx={cx} cy={cy} r={8} className="fill-none stroke-accent" strokeWidth={1.5} />
      )}
      <circle cx={cx} cy={cy} r={4.5} strokeWidth={1.75} className={look} />
    </g>
  );
}

/** Copies the map as a Mermaid flowchart, for pasting into a PR description or a doc. */
export function CopyMermaid({ stack }: { stack: StackSummary }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  return (
    <button
      type="button"
      className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-raised hover:text-text"
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
      {copied === "yes" ? "Copied" : copied === "failed" ? "Couldn't copy" : "Copy as Mermaid"}
    </button>
  );
}

import type { StackSummary } from "@strata/core/model";
import { layoutStackMap } from "@strata/core/stack";
import { useMemo } from "react";
import { Icon } from "../components/Icon";
import { Dot, EdgeLine, gutterWidth, laneX } from "../components/StackMap";
import { prUrl } from "../lib/github";
import { type ApprovalsView, RowApprove } from "./Approve";

/** One row: the PR's title, and its branch under it. */
const ROW = 46;

/**
 * The whole stack as a vertical graph, at the left of the page: the trunk at the
 * bottom, tips on top, a fork as two branches. PRs on this Change's path
 * scope the page; a PR on another branch is dimmed, and choosing it opens
 * the Change for its path.
 */
export function StackRail({
  stack,
  path,
  pr,
  onScope,
  onPickPath,
  pickingPath,
  marks,
  approvals,
}: {
  stack: StackSummary;
  /** This Change's path, bottom first. */
  path: number[];
  /** The PR the page is scoped to, if any. */
  pr: number | null;
  onScope: (pr: number | null) => void;
  /** Opens the Change whose path ends at this tip. */
  onPickPath?: ((tip: number) => void) | undefined;
  /** The tip whose Change is being opened. */
  pickingPath: number | null;
  /** A word or two per PR, such as "CI fails", from its verification. */
  marks?: Map<number, string> | undefined;
  /** Approvals on GitHub; absent on the CLI's page. */
  approvals?: ApprovalsView | undefined;
}) {
  const layout = useMemo(() => layoutStackMap(stack), [stack]);
  const prs = new Map(stack.prs.map((p) => [p.number, p]));
  const onPath = (n: number) => path.includes(n);
  // A PR off the path opens its own path: the newest one through it, as the server would pick.
  const tipFor = (n: number) => {
    const through = stack.paths.filter((p) => p.includes(n));
    const preferred = through.find((p) => p.join() === stack.defaultPath.join()) ?? through[0];
    return preferred?.[preferred.length - 1] ?? n;
  };
  const gutter = gutterWidth(layout.lanes);
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
          <EdgeLine key={edge.child} edge={edge} dim={!onPath(edge.child)} row={ROW} />
        ))}
        {layout.nodes.map((node) => (
          <Dot
            key={node.pr}
            cx={laneX(node.lane)}
            cy={node.row * ROW + ROW / 2}
            active={node.pr === pr}
            dim={!onPath(node.pr)}
            state={prs.get(node.pr)?.state}
          />
        ))}
      </svg>
      <ul aria-label="Pull requests" className="grid grid-cols-[minmax(0,1fr)]">
        {layout.nodes.map((node) => {
          const n = node.pr;
          const title = prs.get(n)?.title ?? "";
          const branch = prs.get(n)?.headRef;
          const here = onPath(n);
          const tip = tipFor(n);
          const state = prs.get(n)?.state;
          // A merged or closed PR says so; its CI is no longer news.
          const mark =
            state === "merged" ? "Merged" : state === "closed" ? "Closed" : marks?.get(n);
          return (
            <li
              key={n}
              data-pr={n}
              className="relative"
              style={{ height: ROW, paddingLeft: gutter - 6 }}
            >
              <button
                type="button"
                className={`flex h-full w-full min-w-0 flex-col justify-center rounded-md px-2 text-left hover:bg-hover aria-[current=true]:bg-active ${here ? "" : "faint opacity-50"} ${here && approvals?.data ? "pr-16" : "pr-9"}`}
                aria-label={here ? `Show #${n} ${title}` : `Open the path through #${n} ${title}`}
                aria-current={pr === n ? "true" : undefined}
                title={
                  here
                    ? `#${n} ${title}${state === "merged" ? "\nThis PR is merged" : state === "closed" ? "\nThis PR is closed" : ""}`
                    : `#${n} ${title}\nThis PR is on another branch. Open its path`
                }
                disabled={!here && (!onPickPath || pickingPath !== null)}
                onClick={() => (here ? onScope(pr === n ? null : n) : onPickPath?.(tip))}
              >
                <span className="flex w-full min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[12.5px] text-faint">{n}</span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[14px] ${state === "open" || !state ? "text-text" : "text-muted"}`}
                  >
                    {title}
                  </span>
                  {!here && pickingPath === tip ? (
                    <span className="shrink-0 text-[12px] text-muted">Opening…</span>
                  ) : (
                    mark && (
                      <span className="shrink-0 text-[12px] text-muted" data-mark={state}>
                        {mark}
                      </span>
                    )
                  )}
                </span>
                {branch && (
                  <span
                    className="block w-full truncate font-mono text-[12px] text-faint"
                    title={branch}
                  >
                    {branch}
                  </span>
                )}
              </button>
              <span className="row-acts">
                {here && approvals && <RowApprove approvals={approvals} pr={n} title={title} />}
                <a
                  href={prUrl(stack.repo, n)}
                  target="_blank"
                  rel="noreferrer"
                  className="ib text-faint"
                  aria-label={`Open #${n} on GitHub`}
                  title={`Open #${n} on GitHub`}
                >
                  <Icon name="external" />
                </a>
              </span>
            </li>
          );
        })}
        <li
          data-trunk={stack.trunk}
          style={{ height: ROW, paddingLeft: gutter + 2 }}
          className="flex items-center font-mono text-[12.5px] text-faint"
        >
          {stack.trunk}
        </li>
      </ul>
    </div>
  );
}

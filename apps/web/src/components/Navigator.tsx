import type { ChangeReport, StackSummary } from "@strata/core/model";
import { LAYERS } from "@strata/core/model";
import { countPrs } from "../lib/format";
import { CopyMermaid, StackMap } from "./StackMap";

/**
 * The rail: the whole stack, then the stack map, where choosing a PR scopes
 * the panes to it. Layers join it once the diff is analysed.
 */
export function Navigator({
  report,
  summary,
  scope,
  onScope,
}: {
  report: ChangeReport | null;
  summary: StackSummary | null;
  scope: number | null;
  onScope: (pr: number | null) => void;
}) {
  const path = summary?.defaultPath ?? [];
  const pathPrs = summary?.prs.filter((pr) => path.includes(pr.number)) ?? [];
  return (
    <nav
      aria-label="Change"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface"
    >
      {summary && (
        <>
          <button
            type="button"
            aria-current={scope === null ? "true" : undefined}
            onClick={() => onScope(null)}
            className={`mx-2 mt-2 flex flex-col rounded-md px-2 py-1.5 text-left ${
              scope === null ? "bg-raised ring-1 ring-accent/50" : "hover:bg-raised"
            }`}
          >
            <span className="font-medium">Whole stack</span>
            <span className="text-[11px] text-muted">{countPrs(pathPrs)}</span>
          </button>
          <div className="mt-3 flex items-center justify-between px-4">
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Stack</span>
            <CopyMermaid stack={summary} />
          </div>
          <div className="px-2 pt-1 pb-3">
            <StackMap
              stack={summary}
              path={path}
              active={scope}
              onSelect={(pr) => onScope(pr === scope ? null : pr)}
            />
          </div>
        </>
      )}
      {report && report.change.layers.length > 0 && (
        <div className="border-t border-line p-2">
          <div className="px-2 py-1 text-xs font-medium tracking-wide text-muted uppercase">
            Layers
          </div>
          {report.change.layers.map((group) => (
            <div
              key={group.layer}
              className="flex justify-between rounded px-2 py-1 hover:bg-raised"
            >
              <span>{LAYERS[group.layer].title}</span>
              <span className="text-muted">{group.files.length}</span>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

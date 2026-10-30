import type { StackSummary } from "@strata/core/model";
import { describePath } from "../lib/format";

/**
 * A stack that forks has a path, and a Change, per tip. This lists them so
 * the reviewer can pick which one to read. Nothing shows for a single path.
 */
export function PathPicker({
  stack,
  current,
  onPick,
  pending = null,
}: {
  stack: StackSummary;
  current: number[];
  /** Called with the chosen path's tip PR. */
  onPick?: (tip: number) => void;
  /** The tip whose Change is being opened. */
  pending?: number | null;
}) {
  if (stack.paths.length < 2) return null;
  const titles = new Map(stack.prs.map((pr) => [pr.number, pr.title]));
  const same = (path: number[]) => path.join(",") === current.join(",");
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[13px] text-muted">
        This stack forks into {stack.paths.length} paths. Each one is its own Change.
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {stack.paths.map((path) => {
          const tip = path[path.length - 1] as number;
          const selected = same(path);
          return (
            <button
              key={tip}
              type="button"
              aria-pressed={selected}
              disabled={!onPick || selected || pending !== null}
              onClick={() => onPick?.(tip)}
              title={path.map((n) => `#${n} ${titles.get(n) ?? ""}`).join("\n")}
              className={`flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border px-2 text-left text-[13px] ${
                selected ? "border-accent-line bg-active" : "border-line hover:bg-hover"
              } disabled:cursor-default`}
            >
              <span className="shrink-0 font-mono text-faint">{describePath(path)}</span>
              <span className="truncate">{titles.get(tip)}</span>
              {pending === tip && <span className="shrink-0 text-muted">Opening…</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

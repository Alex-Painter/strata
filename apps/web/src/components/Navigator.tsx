import type { ChangeReport } from "@strata/core/model";
import { LAYERS } from "@strata/core/model";

const SECTIONS = [
  "Overview",
  "Context",
  "Layers",
  "Diagrams",
  "Findings",
  "Intent ledger",
] as const;

/** Everything in the Change, grouped the way a reviewer reads it. */
export function Navigator({ report }: { report: ChangeReport | null }) {
  return (
    <nav
      aria-label="Change"
      className="w-60 shrink-0 overflow-y-auto border-r border-line bg-surface p-2"
    >
      {SECTIONS.map((section) => (
        <div key={section} className="mb-3">
          <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted">
            {section}
          </div>
          {section === "Layers" &&
            report?.change.layers.map((group) => (
              <div
                key={group.layer}
                className="flex justify-between rounded px-2 py-1 hover:bg-raised"
              >
                <span>{LAYERS[group.layer].title}</span>
                <span className="text-muted">{group.files.length}</span>
              </div>
            ))}
        </div>
      ))}
    </nav>
  );
}

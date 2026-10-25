import type { ChangeReport } from "@strata/core/model";

/**
 * Where context is read. Milestone 1 opens overview, layer, context-source,
 * file and diagram panes here, up to three side by side, and turns text
 * selections in them into anchors for chat.
 */
export function PaneArea({ report }: { report: ChangeReport | null }) {
  return (
    <main className="flex min-w-0 flex-1 overflow-hidden">
      <section className="flex-1 overflow-y-auto p-6">
        {report ? (
          <h2 className="text-base font-semibold">{report.verdict.headline}</h2>
        ) : (
          <p className="text-muted">Nothing to show yet: this Change hasn't been analysed.</p>
        )}
      </section>
    </main>
  );
}

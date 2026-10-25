import type { ChangeReport, MeResponse } from "@strata/core/model";
import { ChatPanel } from "../components/ChatPanel";
import { Navigator } from "../components/Navigator";
import { PaneArea } from "../components/PaneArea";
import { TopBar } from "../components/TopBar";

/**
 * The review workspace: every kind of context side by side, with chat beside
 * it. Left, a navigator over the Change (overview, context sources, layers,
 * diagrams, findings, ledger). Centre, up to three panes open at once, so a
 * spec and the code that implements it can be read together. Right, chat
 * about whatever the reviewer highlights. The scaffold lays out the regions;
 * milestone 1 fills them from the ChangeReport.
 */
export function WorkspacePage({
  report,
  mode,
  me,
}: {
  report: ChangeReport | null;
  /** "static" when rendered from a CLI-written page with no server. */
  mode: "server" | "static";
  me?: MeResponse;
}) {
  return (
    <div className="flex h-full flex-col">
      <TopBar {...(me ? { me } : {})}>
        <span className="truncate font-medium">{report?.change.title ?? "Change"}</span>
        {report && <span className="truncate text-muted">{report.verdict.headline}</span>}
      </TopBar>
      <div className="flex min-h-0 flex-1">
        <Navigator report={report} />
        <PaneArea report={report} />
        <ChatPanel mode={mode} />
      </div>
    </div>
  );
}

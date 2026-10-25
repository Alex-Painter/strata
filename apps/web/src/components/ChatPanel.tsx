/** Chat about the Change. Highlights in any pane arrive here as anchors. */
export function ChatPanel({ mode }: { mode: "server" | "static" }) {
  return (
    <aside
      aria-label="Chat"
      className="flex w-80 shrink-0 flex-col border-l border-line bg-surface"
    >
      <div className="border-b border-line px-3 py-2 font-medium">Chat</div>
      <div className="flex-1 p-3 text-muted">
        {mode === "static"
          ? "This page is a snapshot. Chat needs the Strata server."
          : "Highlight anything in the spec, the code or a diagram, then ask about it here."}
      </div>
    </aside>
  );
}

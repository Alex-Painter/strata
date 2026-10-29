/** The Change pane's width limits, in pixels. */
export const PANE_MIN = 220;
export const PANE_MAX = 560;

/**
 * A handle on a pane's edge: drag it, or focus it and press the arrow keys
 * (Shift for bigger steps), to change the pane's width.
 */
export function PaneHandle({
  width,
  onWidth,
  edge = "right",
  min = PANE_MIN,
  max = PANE_MAX,
  label = "Resize the pane",
}: {
  width: number;
  onWidth: (width: number) => void;
  /** The pane's edge the handle sits on. On the left edge, dragging left widens the pane. */
  edge?: "left" | "right";
  min?: number;
  max?: number;
  label?: string;
}) {
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const grow = edge === "right" ? 1 : -1;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resize handle.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className={`absolute top-0 bottom-0 z-10 w-1.5 cursor-col-resize hover:bg-accent-line focus-visible:bg-accent-line ${edge === "right" ? "right-0" : "left-0"}`}
      onPointerDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        const start = width;
        const move = (e: PointerEvent) => onWidth(clamp(start + grow * (e.clientX - startX)));
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        if (event.key === "ArrowLeft") onWidth(clamp(width - grow * step));
        else if (event.key === "ArrowRight") onWidth(clamp(width + grow * step));
        else return;
        event.preventDefault();
      }}
    />
  );
}

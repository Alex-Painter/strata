import {
  type Anchor,
  anchorForRange,
  lineColumnToOffset,
  type SourceRef,
  surfaceText,
} from "@strata/core/model";

/**
 * Turns a text selection into an anchor.
 *
 * A surface that can be highlighted marks its root with `data-anchor-source`
 * (a JSON SourceRef), each of its lines with `data-anchor-line`, and the text
 * of each line with `data-anchor-text`. Line numbers and +/- markers sit
 * outside the text, so a selection that starts on them starts at column 0.
 * A selection that crosses two surfaces, or that is not in one, gives null.
 */
export function selectionAnchor(selection: Selection | null): Anchor | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  return rangeAnchor(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
}

export function rangeAnchor(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): Anchor | null {
  const root = surfaceOf(startNode);
  if (!root || surfaceOf(endNode) !== root) return null;
  let source: SourceRef;
  try {
    source = JSON.parse(root.dataset.anchorSource ?? "") as SourceRef;
  } catch {
    return null;
  }
  const texts = [...root.querySelectorAll<HTMLElement>("[data-anchor-text]")];
  const lines = texts.map((text) => text.textContent ?? "");
  const start = position(texts, startNode, startOffset, "start");
  const end = position(texts, endNode, endOffset, "end");
  if (!start || !end) return null;
  const from = lineColumnToOffset(lines, start.line, start.column);
  const to = lineColumnToOffset(lines, end.line, end.column);
  if (to <= from) return null;
  const anchor = anchorForRange(source, surfaceText(lines), { start: from, end: to });
  return anchor.quote?.exact.trim() ? anchor : null;
}

function surfaceOf(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-anchor-source]") ?? null;
}

/** A DOM point as (line, column) in the surface's text. */
function position(
  texts: HTMLElement[],
  node: Node,
  offset: number,
  side: "start" | "end",
): { line: number; column: number } | null {
  const element = node instanceof Element ? node : node.parentElement;
  const lineElement = element?.closest<HTMLElement>("[data-anchor-line]");
  // A point outside every line, such as the hunk's header, is before line 0.
  if (!lineElement) return side === "start" ? { line: 0, column: 0 } : null;
  const line = Number(lineElement.dataset.anchorLine);
  const text = texts[line];
  if (!text) return null;
  if (text.contains(node)) {
    const before = document.createRange();
    before.setStart(text, 0);
    before.setEnd(node, offset);
    return { line, column: before.toString().length };
  }
  // On the line number or marker: before the text. Past it: the line's end.
  const after = text.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
  return { line, column: after ? (text.textContent ?? "").length : 0 };
}

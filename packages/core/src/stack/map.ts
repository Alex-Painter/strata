/**
 * The stack map: where each PR sits when the stack is drawn, and the same
 * picture as Mermaid text to copy elsewhere.
 *
 * The layout is computed here rather than in the browser so it's the same
 * wherever the map is drawn, and tests can check its structure. Like
 * `git log --graph`, each PR gets its own row: tips at the top, the bottom PR
 * just above the trunk. A PR's first child carries on in its lane and each
 * other child opens a new lane to the right, so an edge never runs through
 * another PR.
 */
import type { StackPrSummary, StackSummary } from "../model/api.js";
import type { LinkState } from "../model/stack.js";

export interface StackMapNode {
  pr: number;
  /** 0 is the top row. */
  row: number;
  /** 0 is the leftmost lane, the trunk's. */
  lane: number;
}

export interface StackMapEdge {
  /** The PR below; null when the child is the bottom PR and this edge comes from the trunk. */
  parent: number | null;
  child: number;
  from: { row: number; lane: number };
  to: { row: number; lane: number };
  /** `dashed`: the child needs a restack. `dotted`: git couldn't tell how they link. */
  line: "solid" | "dashed" | "dotted";
}

export interface StackMapLayout {
  /** Top to bottom. */
  nodes: StackMapNode[];
  edges: StackMapEdge[];
  /** The trunk's row, below every PR. */
  trunkRow: number;
  lanes: number;
}

export function layoutStackMap(stack: Pick<StackSummary, "prs">): StackMapLayout {
  const children = new Map<number | null, StackPrSummary[]>();
  for (const pr of stack.prs) {
    const siblings = children.get(pr.parent) ?? [];
    siblings.push(pr);
    children.set(pr.parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.number - b.number);

  // Depth first from the bottom, so each subtree's rows are contiguous; reversed, it puts tips on top.
  const order: { pr: StackPrSummary; lane: number }[] = [];
  let lanes = 0;
  const visit = (pr: StackPrSummary, lane: number) => {
    order.push({ pr, lane });
    (children.get(pr.number) ?? []).forEach((child, i) => {
      visit(child, i === 0 ? lane : lanes++);
    });
  };
  // A summary has one bottom PR; any other parentless PR gets its own lane.
  for (const root of children.get(null) ?? []) visit(root, lanes++);
  for (const pr of stack.prs) {
    if (!order.some((entry) => entry.pr === pr)) visit(pr, lanes++);
  }

  const last = order.length - 1;
  const nodes = order.map(({ pr, lane }, i) => ({ pr: pr.number, row: last - i, lane })).reverse();
  const at = new Map(nodes.map((node) => [node.pr, node]));
  const trunkRow = order.length;
  const edges: StackMapEdge[] = order.map(({ pr }) => {
    const to = at.get(pr.number) as StackMapNode;
    const from = pr.parent === null ? undefined : at.get(pr.parent);
    return {
      parent: from ? pr.parent : null,
      child: pr.number,
      from: from ? { row: from.row, lane: from.lane } : { row: trunkRow, lane: 0 },
      to: { row: to.row, lane: to.lane },
      line: lineFor(pr.link),
    };
  });
  return { nodes, edges, trunkRow, lanes: Math.max(lanes, 1) };
}

function lineFor(link: LinkState | null): StackMapEdge["line"] {
  if (link === "behind" || link === "stale") return "dashed";
  if (link === "unknown") return "dotted";
  return "solid";
}

/**
 * The map as a Mermaid flowchart, trunk at the bottom. Each PR links to
 * GitHub; merged PRs are muted and restack edges dashed, as in the app.
 */
export function stackMermaid(stack: Pick<StackSummary, "prs" | "trunk">): string {
  const id = (n: number) => `pr${n}`;
  const lines = ["flowchart BT", `  trunk["${mermaidText(stack.trunk)}"]`];
  for (const pr of stack.prs) {
    const state = pr.draft && pr.state === "open" ? "draft" : pr.state;
    lines.push(`  ${id(pr.number)}["${mermaidText(`#${pr.number} ${pr.title}`)}<br/>${state}"]`);
  }
  for (const pr of stack.prs) {
    const from = pr.parent === null ? "trunk" : id(pr.parent);
    const line = lineFor(pr.link);
    const arrow =
      line === "dashed" ? "-.->|needs restack|" : line === "dotted" ? "-.->|unknown|" : "-->";
    lines.push(`  ${from} ${arrow} ${id(pr.number)}`);
  }
  for (const pr of stack.prs) lines.push(`  click ${id(pr.number)} "${encodeURI(pr.url)}"`);
  const muted = stack.prs.filter((pr) => pr.state !== "open").map((pr) => id(pr.number));
  if (muted.length > 0) {
    lines.push("  classDef landed fill:#f4f4f6,stroke:#9a9aa6,color:#6b6b76");
    lines.push(`  class ${muted.join(",")} landed`);
  }
  return `${lines.join("\n")}\n`;
}

/** Mermaid decodes `#name;` entities in labels, so `#` itself is written as one. */
function mermaidText(text: string): string {
  return text
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/[\r\n]+/g, " ");
}

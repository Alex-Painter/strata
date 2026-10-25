/**
 * Prints stacks as trees, bottom PR first, the way `strata stacks` shows them.
 */
import type { Stack, StackNode } from "@strata/core";

export function formatStacks(repo: string, stacks: Stack[]): string {
  if (stacks.length === 0) return `${repo}: no stacks among PRs updated in the last 90 days.\n`;
  const blocks = stacks.map(formatStack);
  const count = stacks.length === 1 ? "1 stack" : `${stacks.length} stacks`;
  return `${repo}: ${count}\n\n${blocks.join("\n")}`;
}

function formatStack(stack: Stack): string {
  const byNumber = new Map(stack.nodes.map((node) => [node.pr.number, node]));
  const edges = new Map(stack.edges.map((edge) => [edge.child, edge]));
  const lines: string[] = [];
  const base = stack.base ? stack.base.slice(0, 7) : "unknown";
  const trunk = stack.trunk.isDefault ? stack.trunk.name : `${stack.trunk.name} (not the default)`;

  const walk = (node: StackNode, lead: string, branch: string) => {
    const edge = edges.get(node.pr.number);
    const link = edge
      ? edge.via === "retarget"
        ? `${edge.link}, retargeted`
        : edge.link
      : `left ${trunk} at ${base}`;
    lines.push(`${lead}${branch}${label(node)}  ${link}`);
    const childLead = lead + (branch === "├─ " ? "│  " : branch === "└─ " ? "   " : "");
    node.children.forEach((child, i) => {
      const last = i === node.children.length - 1;
      walk(byNumber.get(child) as StackNode, childLead, last ? "└─ " : "├─ ");
    });
  };
  const root = byNumber.get(stack.root);
  if (root) walk(root, "", "");
  for (const issue of stack.issues) lines.push(`  ! ${issue.message}`);
  return `${lines.join("\n")}\n`;
}

function label(node: StackNode): string {
  const { pr } = node;
  const state = pr.state === "open" && pr.draft ? "draft" : pr.state;
  return `#${pr.number} ${pr.title} [${state}]`;
}

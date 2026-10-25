/**
 * The slim view of a stack that the stack list shows: who, what state, how
 * each PR sits on the one below. The full Stack (anchors, evidence) stays
 * with the Change.
 */
import type { StackSummary } from "../model/api.js";
import type { Stack } from "../model/stack.js";

export function summarizeStack(stack: Stack): StackSummary {
  const links = new Map(stack.edges.map((edge) => [edge.child, edge.link]));
  const prs = stack.nodes.map(({ pr, parent }) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    state: pr.state,
    draft: pr.draft,
    updatedAt: pr.updatedAt,
    parent,
    link: links.get(pr.number) ?? null,
    review: pr.review,
    checks: pr.checks,
  }));
  return {
    id: stack.id,
    repo: stack.repo,
    trunk: stack.trunk.name,
    root: stack.root,
    prs,
    paths: stack.paths,
    defaultPath: stack.selectedPath,
    issues: stack.issues,
    updatedAt:
      prs
        .map((pr) => pr.updatedAt)
        .sort()
        .pop() ?? "",
  };
}

/** Newest activity first, then by bottom PR. */
export function byRecentActivity(a: StackSummary, b: StackSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.root - b.root;
}

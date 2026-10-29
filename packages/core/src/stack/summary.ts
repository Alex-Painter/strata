/**
 * The slim view of a stack that the stack list shows: who, what state, how
 * each PR sits on the one below. The full Stack (anchors, evidence) stays
 * with the Change.
 */
import type { StackSummary } from "../model/api.js";
import type { Stack } from "../model/stack.js";

export function summarizeStack(stack: Stack): StackSummary {
  const edges = new Map(stack.edges.map((edge) => [edge.child, edge]));
  const prs = stack.nodes.map(({ pr, parent }) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    state: pr.state,
    draft: pr.draft,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    mergedAt: pr.mergedAt,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    mergeCommitOid: pr.mergeCommitOid,
    parent,
    link: edges.get(pr.number)?.link ?? null,
    linkEvidence: edges.get(pr.number)?.evidence ?? [],
    review: pr.review,
    checks: pr.checks,
  }));
  return {
    id: stack.id,
    repo: stack.repo,
    trunk: stack.trunk.name,
    base: stack.base,
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

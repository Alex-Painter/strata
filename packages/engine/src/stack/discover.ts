/**
 * Every stack in a PR index. The git repo must already hold the trunk, the
 * branches and the head of every PR in `groupsToFind(index, options.open)`.
 */
import { linkedGroups, type PrIndex, type Stack } from "@strata/core";
import { type ResolveStackOptions, resolveStack } from "./resolve.js";

export interface DiscoverOptions extends ResolveStackOptions {
  /** Told how many groups of linked PRs are done, before each one. */
  onProgress?: (step: string) => void;
  /** Only stacks with an open PR, skipping the git work for fully closed groups. */
  open?: boolean;
}

/** The groups of linked PRs to look at; with `open`, only those with an open PR. */
export function groupsToFind(index: PrIndex, open = false): number[][] {
  const groups = linkedGroups(index);
  if (!open) return groups;
  const isOpen = new Set(index.prs.filter((pr) => pr.state === "open").map((pr) => pr.number));
  return groups.filter((group) => group.some((number) => isOpen.has(number)));
}

export async function discoverStacks(
  index: PrIndex,
  gitDir: string,
  options: DiscoverOptions = {},
): Promise<Stack[]> {
  const stacks = new Map<string, Stack>();
  const covered = new Set<number>();
  const groups = groupsToFind(index, options.open);
  for (const [i, group] of groups.entries()) {
    options.onProgress?.(
      `Strata finds the stacks: ${i} of ${groups.length} groups of linked PRs are complete`,
    );
    for (const number of group) {
      if (covered.has(number)) continue;
      let stack = await resolveStack(index, { pr: number }, gitDir, options);
      // Seed from the bottom so the selected path is the default one.
      if (stack.root !== number)
        stack = await resolveStack(index, { pr: stack.root }, gitDir, options);
      for (const node of stack.nodes) covered.add(node.pr.number);
      // Metadata linked these PRs, but the builder may still cut a link (a cycle).
      if (stack.nodes.length > 1) stacks.set(stack.id, stack);
    }
  }
  return [...stacks.values()].sort((a, b) => a.root - b.root);
}

/**
 * Every stack in a PR index. The git repo must already hold the trunk, the
 * branches and the head of every PR in `linkedGroups(index)`.
 */
import { linkedGroups, type PrIndex, type Stack } from "@strata/core";
import { type ResolveStackOptions, resolveStack } from "./resolve.js";

export async function discoverStacks(
  index: PrIndex,
  gitDir: string,
  options: ResolveStackOptions = {},
): Promise<Stack[]> {
  const stacks = new Map<string, Stack>();
  const covered = new Set<number>();
  for (const group of linkedGroups(index)) {
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

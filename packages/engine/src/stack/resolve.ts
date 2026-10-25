/**
 * Turns PR metadata into a stack, answering the core builder's git questions
 * from a local repo that already holds the commits (Strata's cache, or a
 * fixture in tests). Fetching the commits is the caller's job.
 */
import {
  buildStack,
  emptyFacts,
  type FactRequest,
  factKey,
  type GitFacts,
  mergeFacts,
  type PrIndex,
  type Stack,
  type StackSeed,
} from "@strata/core";
import { git } from "../git/run.js";

export interface ResolveStackOptions {
  /** Where a branch's tip lives in `gitDir`. Defaults to `refs/heads/<branch>`. */
  refFor?: (branch: string) => string;
  /**
   * A safety stop. Most stacks need a handful of rounds; a chain of PRs that
   * each need a restack takes about one more per PR. Defaults to plenty for
   * every PR in the index.
   */
  maxRounds?: number;
}

export async function resolveStack(
  index: PrIndex,
  seed: StackSeed,
  gitDir: string,
  options: ResolveStackOptions = {},
): Promise<Stack> {
  const maxRounds = options.maxRounds ?? 16 + 4 * index.prs.length;
  let facts = emptyFacts();
  for (let round = 0; round < maxRounds; round++) {
    const result = buildStack(index, seed, facts);
    if (result.kind === "done") return result.stack;
    const known = factCount(facts);
    facts = mergeFacts(facts, await answerFacts(gitDir, result.requests, options.refFor));
    // Each round must learn something, or the builder is asking in circles.
    if (factCount(facts) === known) {
      throw new Error(`Stack for ${index.repo} asked again for git facts it already has.`);
    }
  }
  throw new Error(`Stack for ${index.repo} still needed git facts after ${maxRounds} rounds.`);
}

function factCount(facts: GitFacts): number {
  return Object.values(facts).reduce((sum, table) => sum + Object.keys(table).length, 0);
}

const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Answers the builder's questions with git. Unanswerable ones come back null. */
export async function answerFacts(
  gitDir: string,
  requests: FactRequest[],
  refFor: (branch: string) => string = (branch) => `refs/heads/${branch}`,
): Promise<GitFacts> {
  const facts = emptyFacts();
  await inBatches(requests, 8, async (request) => {
    switch (request.kind) {
      case "is-ancestor": {
        const key = factKey(request.a, request.b);
        if (!OID.test(request.a) || !OID.test(request.b)) {
          facts.isAncestor[key] = null;
          return;
        }
        // Exit 0: ancestor. 1: not. Anything else: git couldn't tell.
        const { code } = await git(gitDir, ["merge-base", "--is-ancestor", request.a, request.b]);
        facts.isAncestor[key] = code === 0 ? true : code === 1 ? false : null;
        return;
      }
      case "merge-base": {
        const key = factKey(request.a, request.b);
        if (!OID.test(request.a) || !OID.test(request.b)) {
          facts.mergeBase[key] = null;
          return;
        }
        // With several best bases (criss-cross merges), plain merge-base picks one
        // by commit date. Strata would rather say it can't tell.
        const result = await git(gitDir, ["merge-base", "--all", request.a, request.b]);
        const bases = result.code === 0 ? result.stdout.trim().split("\n").filter(Boolean) : [];
        facts.mergeBase[key] = bases.length === 1 ? (bases[0] as string) : null;
        return;
      }
      case "first-parent":
        facts.firstParent[request.oid] = OID.test(request.oid)
          ? await revParse(gitDir, `${request.oid}^1`)
          : null;
        return;
      case "tip":
        facts.tip[request.ref] = await revParse(gitDir, `${refFor(request.ref)}^{commit}`);
        return;
    }
  });
  return facts;
}

async function revParse(gitDir: string, rev: string): Promise<string | null> {
  const result = await git(gitDir, ["rev-parse", "--verify", "--quiet", rev]);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

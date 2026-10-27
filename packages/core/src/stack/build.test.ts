import { describe, expect, it } from "vitest";
import type { GitFacts, PrIndex, Stack, StackPr, StackSeed } from "../model/stack.js";
import { buildStack, emptyFacts, factKey, linkedGroups, mergeFacts, StackError } from "./build.js";

/**
 * Each case describes a tiny commit graph and the PRs on it, then checks the
 * stack the builder finds. The graph answers the builder's git questions the
 * way the engine does, so these tests also exercise the ask-and-answer loop.
 * The engine's own tests repeat the git-dependent cases against real repos.
 */

/** commit → parents, first parent first. */
type Graph = Record<string, string[]>;

const T0 = Date.UTC(2026, 9, 1);
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();

function pr(number: number, fields: Partial<StackPr> = {}): StackPr {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    author: "dev",
    state: "open",
    draft: false,
    createdAt: at(number),
    updatedAt: at(number),
    mergedAt: null,
    closedAt: null,
    baseRef: "main",
    headRef: `b${number}`,
    headOid: `h${number}`,
    crossRepository: false,
    mergeCommitOid: null,
    baseOid: null,
    baseChanges: [],
    forcePushes: [],
    review: null,
    checks: null,
    ...fields,
  };
}

function ancestorsOf(graph: Graph, oid: string): Set<string> | null {
  if (!graph[oid]) return null;
  const seen = new Set<string>();
  const queue = [oid];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(graph[next] ?? []));
  }
  return seen;
}

function mergeBaseOf(graph: Graph, a: string, b: string): string | null {
  const fromA = ancestorsOf(graph, a);
  const fromB = ancestorsOf(graph, b);
  if (!fromA || !fromB) return null;
  const common = [...fromA].filter((oid) => fromB.has(oid));
  // The best common ancestors: those that no other common ancestor descends from.
  const best = common.filter(
    (oid) => !common.some((other) => other !== oid && ancestorsOf(graph, other)?.has(oid)),
  );
  return best.sort()[0] ?? null;
}

/** Runs the builder to completion, answering its questions from the graph. */
function resolve(
  index: PrIndex,
  seed: StackSeed,
  graph: Graph,
  tips: Record<string, string> = {},
): { stack: Stack; rounds: number } {
  let facts: GitFacts = emptyFacts();
  for (let rounds = 1; rounds <= 50; rounds++) {
    const result = buildStack(index, seed, facts);
    if (result.kind === "done") return { stack: result.stack, rounds };
    const answers = emptyFacts();
    for (const request of result.requests) {
      switch (request.kind) {
        case "is-ancestor": {
          const seen = ancestorsOf(graph, request.b);
          answers.isAncestor[factKey(request.a, request.b)] =
            seen && graph[request.a] ? seen.has(request.a) : null;
          break;
        }
        case "merge-base":
          answers.mergeBase[factKey(request.a, request.b)] = mergeBaseOf(
            graph,
            request.a,
            request.b,
          );
          break;
        case "first-parent":
          answers.firstParent[request.oid] = graph[request.oid]?.[0] ?? null;
          break;
        case "tip":
          answers.tip[request.ref] = tips[request.ref] ?? null;
          break;
      }
    }
    facts = mergeFacts(facts, answers);
  }
  throw new Error("The builder kept asking questions.");
}

const index = (...prs: StackPr[]): PrIndex => ({ repo: "acme/app", defaultBranch: "main", prs });
const order = (stack: Stack) => stack.nodes.map((node) => node.pr.number);
const edge = (stack: Stack, child: number) => stack.edges.find((e) => e.child === child);
const anchor = (stack: Stack, n: number) =>
  stack.nodes.find((node) => node.pr.number === n)?.anchor;
const kinds = (stack: Stack) => stack.issues.map((issue) => issue.kind);

/** main: m0 ← m1. A three-PR chain branched from m0. */
const chainGraph: Graph = { m0: [], m1: ["m0"], h1: ["m0"], h2: ["h1"], h3: ["h2"] };
const chain = index(pr(1), pr(2, { baseRef: "b1" }), pr(3, { baseRef: "b2" }));

describe("buildStack", () => {
  it("finds a chain from its middle PR, bottom first", () => {
    const { stack } = resolve(chain, { pr: 2 }, chainGraph, { main: "m1" });
    expect(order(stack)).toEqual([1, 2, 3]);
    expect(stack.root).toBe(1);
    expect(stack.trunk).toEqual({ name: "main", isDefault: true });
    expect(stack.paths).toEqual([[1, 2, 3]]);
    expect(stack.selectedPath).toEqual([1, 2, 3]);
    expect(stack.edges.map((e) => [e.parent, e.child, e.via, e.link])).toEqual([
      [1, 2, "base-ref", "intact"],
      [2, 3, "base-ref", "intact"],
    ]);
    // The stack left main at m0, and each PR's own diff starts at the head below it.
    expect(stack.base).toBe("m0");
    expect([anchor(stack, 1), anchor(stack, 2), anchor(stack, 3)]).toEqual(["m0", "h1", "h2"]);
    expect(stack.issues).toEqual([]);
  });

  it("finds the same stack from any PR in it", () => {
    const a = resolve(chain, { pr: 1 }, chainGraph, { main: "m1" }).stack;
    const b = resolve(chain, { pr: 3 }, chainGraph, { main: "m1" }).stack;
    expect({ ...a, seed: 0 }).toEqual({ ...b, seed: 0 });
  });

  it("doesn't depend on the order of the PR index", () => {
    const shuffled = index(...[...chain.prs].reverse());
    const a = resolve(chain, { pr: 2 }, chainGraph, { main: "m1" }).stack;
    const b = resolve(shuffled, { pr: 2 }, chainGraph, { main: "m1" }).stack;
    expect(b).toEqual(a);
  });

  it("treats a GitHub native stack like any other: its PRs target the branch below", () => {
    const native = index(
      pr(1, { headRef: "stack/feed/1" }),
      pr(2, { baseRef: "stack/feed/1", headRef: "stack/feed/2" }),
    );
    const { stack } = resolve(native, { pr: 2 }, chainGraph, { main: "m1" });
    expect(order(stack)).toEqual([1, 2]);
    expect(edge(stack, 2)?.link).toBe("intact");
  });

  it("asks git only what it needs, and finishes once answered", () => {
    const first = buildStack(chain, { pr: 2 }, emptyFacts());
    expect(first.kind).toBe("needs");
    const { rounds } = resolve(chain, { pr: 2 }, chainGraph, { main: "m1" });
    expect(rounds).toBeLessThanOrEqual(3);
  });

  it("finds a stack from a branch name", () => {
    const { stack } = resolve(chain, { branch: "b3" }, chainGraph, { main: "m1" });
    expect(stack.seed).toBe(3);
    expect(() => buildStack(chain, { branch: "nope" }, emptyFacts())).toThrow(StackError);
    expect(() => buildStack(chain, { pr: 99 }, emptyFacts())).toThrow(StackError);
  });

  describe("forks", () => {
    const graph: Graph = { m0: [], h1: ["m0"], h2: ["h1"], h3: ["h1"] };
    const forked = index(
      pr(1),
      pr(2, { baseRef: "b1", updatedAt: at(50) }),
      pr(3, { baseRef: "b1", updatedAt: at(40) }),
    );

    it("keeps both branches and offers a path to each tip", () => {
      const { stack } = resolve(forked, { pr: 1 }, graph, { main: "m0" });
      expect(order(stack)).toEqual([1, 2, 3]);
      expect(stack.nodes[0]?.children).toEqual([2, 3]);
      expect(stack.paths).toEqual([
        [1, 2],
        [1, 3],
      ]);
      // From the bottom, the most recently updated tip wins.
      expect(stack.selectedPath).toEqual([1, 2]);
    });

    it("follows the seed, or the tip asked for", () => {
      expect(resolve(forked, { pr: 3 }, graph, { main: "m0" }).stack.selectedPath).toEqual([1, 3]);
      expect(resolve(forked, { pr: 1, leaf: 3 }, graph, { main: "m0" }).stack.selectedPath).toEqual(
        [1, 3],
      );
      expect(() => resolve(forked, { pr: 2, leaf: 3 }, graph, { main: "m0" })).toThrow(StackError);
    });
  });

  describe("merged PRs stay in the stack", () => {
    // PR 1 was squash-merged as s1 on top of m1, and GitHub retargeted PR 2 to main.
    const squashed = index(
      pr(1, { state: "merged", mergedAt: at(100), mergeCommitOid: "s1" }),
      pr(2, { baseChanges: [{ from: "b1", to: "main", at: at(100) }] }),
    );

    it("links a retargeted child through its old base", () => {
      const graph: Graph = { m0: [], m1: ["m0"], s1: ["m1"], h1: ["m0"], h2: ["h1"] };
      const { stack } = resolve(squashed, { pr: 2 }, graph, { main: "s1" });
      expect(order(stack)).toEqual([1, 2]);
      expect(edge(stack, 2)).toMatchObject({ via: "retarget", ref: "b1", link: "intact" });
      // Where the stack left main comes from the squash commit's parent, so it
      // doesn't move as main moves on.
      expect(stack.base).toBe("m0");
      // PR 2's own diff starts at PR 1's head, so it doesn't repeat PR 1's changes.
      expect(anchor(stack, 2)).toBe("h1");
    });

    it("marks a child rebased onto main as re-anchored", () => {
      const graph: Graph = { m0: [], m1: ["m0"], s1: ["m1"], h1: ["m0"], h2: ["s1"] };
      const { stack } = resolve(squashed, { pr: 2 }, graph, { main: "s1" });
      expect(edge(stack, 2)?.link).toBe("re-anchored");
      expect(anchor(stack, 2)).toBe("s1");
      expect(kinds(stack)).toEqual([]);
    });

    it("flags an open child that still targets a merged parent's branch", () => {
      const kept = index(
        pr(1, { state: "merged", mergedAt: at(100), mergeCommitOid: "s1" }),
        pr(2, { baseRef: "b1" }),
      );
      const graph: Graph = { m0: [], s1: ["m0"], h1: ["m0"], h2: ["h1"] };
      const { stack } = resolve(kept, { pr: 2 }, graph, { main: "s1", b1: "h1" });
      expect(kinds(stack)).toEqual(["base-already-merged"]);
    });
  });

  describe("links that need a restack", () => {
    it("marks a child behind a parent that moved on", () => {
      // PR 1 got h1b after PR 2 branched from h1.
      const graph: Graph = { m0: [], h1: ["m0"], h1b: ["h1"], h2: ["h1"] };
      const moved = index(pr(1, { headOid: "h1b" }), pr(2, { baseRef: "b1" }));
      const { stack } = resolve(moved, { pr: 2 }, graph, { main: "m0" });
      expect(edge(stack, 2)?.link).toBe("behind");
      expect(anchor(stack, 2)).toBe("h1");
      expect(kinds(stack)).toEqual(["needs-restack"]);
    });

    it("marks a child stale when its parent force-pushed", () => {
      // PR 1 amended h1 into h1x; PR 2 still sits on h1.
      const graph: Graph = { m0: [], h1: ["m0"], h1x: ["m0"], h2: ["h1"] };
      const pushed = index(
        pr(1, { headOid: "h1x", forcePushes: [{ before: "h1", after: "h1x", at: at(30) }] }),
        pr(2, { baseRef: "b1" }),
      );
      const { stack } = resolve(pushed, { pr: 2 }, graph, { main: "m0" });
      expect(edge(stack, 2)?.link).toBe("stale");
      expect(anchor(stack, 2)).toBe("h1");
      expect(kinds(stack)).toEqual(["needs-restack"]);
    });
  });

  describe("choosing between parents", () => {
    it("picks the PR whose head the child holds when a branch name was reused", () => {
      const graph: Graph = { m0: [], old: ["m0"], new: ["m0"], h6: ["new"], h7: ["old"] };
      const reused = index(
        pr(1, { headRef: "feat", headOid: "old", state: "closed", closedAt: at(20) }),
        pr(5, { headRef: "feat", headOid: "new" }),
        pr(6, { baseRef: "feat", headOid: "h6" }),
        pr(7, { baseRef: "feat", headOid: "h7", createdAt: at(10) }),
      );
      expect(order(resolve(reused, { pr: 6 }, graph, { main: "m0" }).stack)).toEqual([5, 6]);
      // A closed PR stays in the stack when a PR sits on it.
      const onClosed = resolve(reused, { pr: 7 }, graph, { main: "m0" }).stack;
      expect(order(onClosed)).toEqual([1, 7]);
      expect(onClosed.nodes[0]?.pr.state).toBe("closed");
    });

    it("says so when only recency separates two parents", () => {
      const graph: Graph = { m0: [], h1: ["m0"], h3: ["h1"] };
      const twins = index(
        pr(1, { headRef: "feat" }),
        pr(2, { headRef: "feat", headOid: "h1", baseRef: "develop" }),
        pr(3, { baseRef: "feat" }),
      );
      const { stack } = resolve(twins, { pr: 3 }, graph, { main: "m0", develop: "m0" });
      expect(order(stack)).toEqual([2, 3]);
      expect(kinds(stack)).toEqual(["non-default-trunk", "ambiguous-parent"]);
    });

    it("prefers the branch a PR targets now over one it was moved off", () => {
      const graph: Graph = { m0: [], h1: ["m0"], h2: ["m0"], h3: ["h2"] };
      const moved = index(
        pr(1),
        pr(2),
        pr(3, { baseRef: "b2", baseChanges: [{ from: "b1", to: "b2", at: at(40) }] }),
      );
      expect(order(resolve(moved, { pr: 3 }, graph, { main: "m0" }).stack)).toEqual([2, 3]);
    });

    it("never takes a fork's branch as a parent", () => {
      const graph: Graph = { m0: [], h1: ["m0"], h2: ["h1"], h3: ["h2"] };
      const forked = index(
        pr(1),
        pr(2, { baseRef: "b1", crossRepository: true }),
        pr(3, { baseRef: "b2" }),
      );
      const { stack } = resolve(forked, { pr: 1 }, graph, { main: "m0" });
      expect(order(stack)).toEqual([1, 2]);
      expect(resolve(forked, { pr: 3 }, graph, { main: "m0" }).stack.root).toBe(3);
    });
  });

  it("cuts a cycle at its newest link", () => {
    const graph: Graph = { m0: [], h1: ["m0"], h2: ["h1"] };
    const looped = index(pr(1, { baseRef: "b2" }), pr(2, { baseRef: "b1" }));
    const { stack } = resolve(looped, { pr: 1 }, graph, { b1: "h1", b2: "h2" });
    expect(order(stack)).toEqual([2, 1]);
    expect(kinds(stack)).toContain("cycle");
  });

  it("flags a stack that doesn't start on the default branch", () => {
    const graph: Graph = { m0: [], h1: ["m0"] };
    const { stack } = resolve(index(pr(1, { baseRef: "develop" })), { pr: 1 }, graph, {
      develop: "m0",
    });
    expect(stack.trunk).toEqual({ name: "develop", isDefault: false });
    expect(kinds(stack)).toEqual(["non-default-trunk"]);
  });

  describe("a stack merged all at once", () => {
    // Each PR was squashed onto main in turn (s1, s2, s3), while GitHub kept
    // each upper PR's base as the branch below.
    const graph: Graph = {
      m0: [],
      h1: ["m0"],
      h2: ["h1"],
      h3: ["h2"],
      s1: ["m0"],
      s2: ["s1"],
      s3: ["s2"],
    };
    const merged = (n: number, fields: Partial<StackPr> = {}) =>
      pr(n, { state: "merged", mergedAt: at(100), mergeCommitOid: `s${n}`, ...fields });
    const landed = index(merged(1), merged(2, { baseRef: "b1" }), merged(3, { baseRef: "b2" }));

    it("links each PR by its head, as before it merged", () => {
      const { stack } = resolve(landed, { pr: 3 }, graph, { main: "s3" });
      expect(order(stack)).toEqual([1, 2, 3]);
      expect(stack.base).toBe("m0");
      expect(edge(stack, 2)?.link).toBe("intact");
      expect(edge(stack, 3)?.link).toBe("intact");
      // Each PR's own diff starts at the head below, as GitHub showed it.
      expect(anchor(stack, 2)).toBe("h1");
      expect(anchor(stack, 3)).toBe("h2");
      expect(kinds(stack)).toEqual([]);
      expect(edge(stack, 3)?.evidence.map((e) => e.label)).toContain("#3 landed on main");
    });

    it("marks a PR rebased onto main before it landed as re-anchored", () => {
      const rebased = { ...graph, h3: ["s2"], s3: ["s2"] };
      const { stack } = resolve(landed, { pr: 3 }, rebased, { main: "s3" });
      expect(edge(stack, 3)?.link).toBe("re-anchored");
      expect(anchor(stack, 3)).toBe("s2");
      expect(kinds(stack)).toEqual([]);
    });

    it("asks no restack of a PR that landed behind its parent", () => {
      // PR 1 got a fixup (h1b) after PR 2 branched from h1; both landed as they were.
      const behind = index(merged(1, { headOid: "h1b" }), merged(2, { baseRef: "b1" }));
      const { stack } = resolve(behind, { pr: 2 }, { ...graph, h1b: ["h1"] }, { main: "s2" });
      expect(edge(stack, 2)?.link).toBe("behind");
      expect(anchor(stack, 2)).toBe("h1");
      expect(kinds(stack)).toEqual([]);
    });

    it("asks no restack of a PR that landed on an old push of its parent", () => {
      // PR 1 was force-pushed from h1 to h1x after PR 2 branched from h1.
      const stale = index(
        merged(1, { headOid: "h1x", forcePushes: [{ before: "h1", after: "h1x", at: at(30) }] }),
        merged(2, { baseRef: "b1" }),
      );
      const { stack } = resolve(stale, { pr: 2 }, { ...graph, h1x: ["m0"] }, { main: "s2" });
      expect(edge(stack, 2)?.link).toBe("stale");
      expect(anchor(stack, 2)).toBe("h1");
      expect(kinds(stack)).toEqual([]);
    });

    it("checks a deleted trunk through the default branch", () => {
      // The stack landed on feat, which was merged into main as mf and deleted.
      const viaFeat = index(
        merged(1, { baseRef: "feat" }),
        merged(2, { baseRef: "b1" }),
        merged(3, { baseRef: "b2" }),
      );
      const { stack } = resolve(viaFeat, { pr: 3 }, { ...graph, mf: ["m0", "s3"] }, { main: "mf" });
      expect(edge(stack, 2)?.link).toBe("intact");
      expect(edge(stack, 3)?.link).toBe("intact");
      expect(anchor(stack, 3)).toBe("h2");
      expect(kinds(stack)).toEqual(["non-default-trunk"]);
      expect(edge(stack, 3)?.evidence.map((e) => e.label)).toContain("#3 landed on main");
    });

    it("claims nothing when it can't tell where a PR landed", () => {
      const noCommit = index(merged(1), merged(2, { baseRef: "b1", mergeCommitOid: null }));
      const { stack } = resolve(noCommit, { pr: 2 }, graph, { main: "s2" });
      expect(edge(stack, 2)?.link).toBe("unknown");
      expect(kinds(stack)).toEqual(["missing-commit"]);
    });

    it("still flags a PR merged into a branch whose PR had already landed", () => {
      // PR 2's merge commit went onto b1 after PR 1 landed, so main never got it.
      const late = index(merged(1, { mergedAt: at(50) }), merged(2, { baseRef: "b1" }));
      const dead = { ...graph, s2: ["h1", "h2"] };
      const { stack } = resolve(late, { pr: 2 }, dead, { main: "s1" });
      expect(edge(stack, 2)?.link).toBe("merged-into-parent");
      expect(kinds(stack)).toEqual(["base-already-merged"]);
    });
  });

  describe("a child merged into its parent's branch", () => {
    // PR 2 was merged into b1 as mm, so PR 1's head now holds it.
    const graph: Graph = { m0: [], h1: ["m0"], h2: ["h1"], mm: ["h1", "h2"] };

    it("is marked merged into its parent", () => {
      const landed = index(
        pr(1, { headOid: "mm" }),
        pr(2, { baseRef: "b1", state: "merged", mergedAt: at(60), mergeCommitOid: "mm" }),
      );
      const { stack } = resolve(landed, { pr: 1 }, graph, { main: "m0" });
      expect(edge(stack, 2)?.link).toBe("merged-into-parent");
      expect(anchor(stack, 2)).toBe("h1");
      expect(kinds(stack)).toEqual([]);
    });

    it("stays merged into its parent when the parent then merged into main", () => {
      // PR 1 was merged into main with a merge commit, so main holds mm too.
      const both = index(
        pr(1, { headOid: "mm", state: "merged", mergedAt: at(70), mergeCommitOid: "mp" }),
        pr(2, { baseRef: "b1", state: "merged", mergedAt: at(60), mergeCommitOid: "mm" }),
      );
      const { stack } = resolve(both, { pr: 1 }, { ...graph, mp: ["m0", "mm"] }, { main: "mp" });
      expect(edge(stack, 2)?.link).toBe("merged-into-parent");
      expect(anchor(stack, 2)).toBe("h1");
      expect(kinds(stack)).toEqual([]);
    });

    it("is flagged when it landed after the parent had merged", () => {
      // PR 1 was squash-merged as s1 first, then PR 2 landed on its dead branch.
      const late = index(
        pr(1, { state: "merged", mergedAt: at(50), mergeCommitOid: "s1" }),
        pr(2, { baseRef: "b1", state: "merged", mergedAt: at(60), mergeCommitOid: "mm" }),
      );
      const { stack } = resolve(late, { pr: 2 }, { ...graph, s1: ["m0"] }, { main: "s1" });
      expect(edge(stack, 2)?.link).toBe("merged-into-parent");
      expect(kinds(stack)).toEqual(["base-already-merged"]);
    });
  });

  it("prefers an open tip over a closed one", () => {
    const graph: Graph = { m0: [], h1: ["m0"], h2: ["h1"], h3: ["h1"] };
    const withClosed = index(
      pr(1),
      pr(2, { baseRef: "b1", state: "closed", closedAt: at(90), updatedAt: at(90) }),
      pr(3, { baseRef: "b1", updatedAt: at(10) }),
    );
    expect(resolve(withClosed, { pr: 1 }, graph, { main: "m0" }).stack.selectedPath).toEqual([
      1, 3,
    ]);
  });

  it("says when git couldn't place a commit", () => {
    // h2 isn't in the local cache.
    const graph: Graph = { m0: [], h1: ["m0"] };
    const { stack } = resolve(chain, { pr: 1 }, graph, { main: "m0" });
    expect(edge(stack, 2)?.link).toBe("unknown");
    expect(anchor(stack, 2)).toBeNull();
    expect(kinds(stack)).toContain("missing-commit");
  });

  it("gives every edge and issue evidence", () => {
    const graph: Graph = { m0: [], h1: ["m0"], h1b: ["h1"], h2: ["h1"] };
    const moved = index(pr(1, { headOid: "h1b" }), pr(2, { baseRef: "b1" }));
    const { stack } = resolve(moved, { pr: 2 }, graph, { main: "m0" });
    for (const item of [...stack.edges, ...stack.issues]) {
      expect(item.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("choosing parents", () => {
  it("never takes a PR from the default branch as a parent", () => {
    // #5 is a release PR from main; #11 and #12 are unrelated work on main.
    const graph: Graph = { m0: [], p0: [], h11: ["m0"], h12: ["m0"] };
    const release = index(
      pr(5, { headRef: "main", baseRef: "production", headOid: "m0", state: "closed" }),
      pr(11),
      pr(12),
    );
    const { stack } = resolve(release, { pr: 11 }, graph, { main: "m0", production: "p0" });
    expect(order(stack)).toEqual([11]);
    expect(linkedGroups(release)).toEqual([]);
  });

  it("drops an old base the PR was moved off while that parent is still open", () => {
    // #1 was opened on #2's branch, then moved to main and rebased there.
    const graph: Graph = { m0: [], h1: ["m0"], h2: ["m0"] };
    const moved = index(pr(1, { baseChanges: [{ from: "b2", to: "main", at: at(30) }] }), pr(2));
    expect(order(resolve(moved, { pr: 1 }, graph, { main: "m0" }).stack)).toEqual([1]);
    expect(order(resolve(moved, { pr: 2 }, graph, { main: "m0" }).stack)).toEqual([2]);
  });

  it("follows a reordered stack instead of calling it a cycle", () => {
    // #2 was first, then the two swapped places and were rebased to match.
    const graph: Graph = { m0: [], h1: ["m0"], h2: ["h1"] };
    const swapped = index(
      pr(1, { baseChanges: [{ from: "b2", to: "main", at: at(30) }] }),
      pr(2, { baseRef: "b1", baseChanges: [{ from: "main", to: "b1", at: at(31) }] }),
    );
    for (const seed of [1, 2]) {
      const { stack } = resolve(swapped, { pr: seed }, graph, { main: "m0", b1: "h1" });
      expect(order(stack)).toEqual([1, 2]);
      expect(edge(stack, 2)?.link).toBe("intact");
      expect(stack.issues).toEqual([]);
    }
  });
});

describe("deep stacks", () => {
  it("resolves a long landed stack in a few rounds", () => {
    // Each PR was squash-merged in turn; the next was retargeted, rebased onto it and merged.
    const n = 40;
    const graph: Graph = { m0: [], h1: ["m0"], s1: ["m0"] };
    const prs = [pr(1, { state: "merged", mergedAt: at(1000), mergeCommitOid: "s1" })];
    for (let i = 2; i <= n; i++) {
      graph[`h${i}`] = [`s${i - 1}`];
      graph[`s${i}`] = [`s${i - 1}`];
      prs.push(
        pr(i, {
          state: "merged",
          mergedAt: at(1000 + i),
          mergeCommitOid: `s${i}`,
          baseChanges: [{ from: `b${i - 1}`, to: "main", at: at(1000 + i - 1) }],
        }),
      );
    }
    const { stack, rounds } = resolve(index(...prs), { pr: n }, graph, { main: `s${n}` });
    expect(order(stack)).toHaveLength(n);
    expect(stack.edges.every((e) => e.link === "re-anchored")).toBe(true);
    expect(anchor(stack, n)).toBe(`s${n - 1}`);
    expect(rounds).toBeLessThanOrEqual(5);
  });

  it("resolves a long chain where every PR needs a restack", () => {
    // Each parent got one more commit (h<i>x) after its child branched.
    const n = 30;
    const graph: Graph = { m0: [], h1: ["m0"] };
    const tips: Record<string, string> = { main: "m0" };
    const prs: StackPr[] = [];
    for (let i = 1; i <= n; i++) {
      if (i > 1) graph[`h${i}`] = [`h${i - 1}`];
      graph[`h${i}x`] = [`h${i}`];
      const head = i < n ? `h${i}x` : `h${i}`;
      tips[`b${i}`] = head;
      prs.push(pr(i, { headOid: head, ...(i > 1 ? { baseRef: `b${i - 1}` } : {}) }));
    }
    const { stack, rounds } = resolve(index(...prs), { pr: 1 }, graph, tips);
    expect(stack.edges.every((e) => e.link === "behind")).toBe(true);
    expect(anchor(stack, n)).toBe(`h${n - 1}`);
    expect(rounds).toBeLessThanOrEqual(n + 5);
  });
});

describe("linkedGroups", () => {
  it("groups PRs joined by current or former bases, and leaves lone PRs out", () => {
    const groups = linkedGroups(
      index(
        pr(1),
        pr(2, { baseRef: "main", baseChanges: [{ from: "b1", to: "main", at: at(30) }] }),
        pr(3, { baseRef: "b2" }),
        pr(4),
        pr(6, { baseRef: "b5" }),
        pr(5),
        pr(7, { baseRef: "b8" }),
        pr(8, { crossRepository: true }),
      ),
    );
    expect(groups).toEqual([
      [1, 2, 3],
      [5, 6],
    ]);
  });
});

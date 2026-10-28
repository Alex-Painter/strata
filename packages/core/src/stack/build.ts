/**
 * Builds a stack from PR metadata plus a few git facts.
 *
 * This stays pure: it never runs git. When it needs a fact it doesn't have
 * (is this commit inside that one? where do these two meet?), it finishes the
 * pass with what it knows and returns the questions instead of a stack. The
 * engine answers them with git and calls again, until the stack is done. Each
 * round only adds facts, so the same index and facts always give the same
 * stack, and tests can hand it a fixed table of facts.
 *
 * A PR's parent is the PR whose head branch is its base, or was its base
 * before GitHub retargeted it (when a merged parent's branch is deleted, its
 * children move to the parent's base). See model/stack.ts for the link states.
 */
import type { Evidence } from "../model/change.js";
import { stableId } from "../model/ids.js";
import type {
  BuildStackResult,
  FactRequest,
  ForcePush,
  GitFacts,
  LinkState,
  PrIndex,
  Stack,
  StackEdge,
  StackIssue,
  StackNode,
  StackPr,
  StackSeed,
} from "../model/stack.js";

export class StackError extends Error {}

export function emptyFacts(): GitFacts {
  return { isAncestor: {}, mergeBase: {}, firstParent: {}, tip: {} };
}

/** The key for a two-commit fact. */
export function factKey(a: string, b: string): string {
  return `${a} ${b}`;
}

/** Facts from `more` win, so a later answer replaces an earlier one. */
export function mergeFacts(facts: GitFacts, more: Partial<GitFacts>): GitFacts {
  return {
    isAncestor: { ...facts.isAncestor, ...more.isAncestor },
    mergeBase: { ...facts.mergeBase, ...more.mergeBase },
    firstParent: { ...facts.firstParent, ...more.firstParent },
    tip: { ...facts.tip, ...more.tip },
  };
}

export function buildStack(index: PrIndex, seed: StackSeed, facts: GitFacts): BuildStackResult {
  const builder = new Builder(index, facts);
  const stack = builder.build(seed);
  const requests = builder.requests();
  return requests.length > 0 ? { kind: "needs", requests } : { kind: "done", stack };
}

/**
 * Groups the PRs that branch links could join into one stack, from metadata
 * alone: each PR with every PR that could be its parent (see canBeParent) and
 * whose head branch it targets or used to target. Groups of two or more come
 * back, each sorted, smallest first.
 * buildStack decides the real trees; this only tells the engine which PR
 * heads to fetch before asking.
 */
export function linkedGroups(index: PrIndex): number[][] {
  const parent = new Map<number, number>();
  const find = (n: number): number => {
    let root = n;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    parent.set(n, root);
    return root;
  };
  const byHeadRef = new Map<string, StackPr[]>();
  for (const pr of index.prs) {
    parent.set(pr.number, pr.number);
    if (canBeParent(pr, index)) push(byHeadRef, pr.headRef, pr);
  }
  for (const pr of index.prs) {
    for (const ref of candidateRefs(pr)) {
      for (const other of byHeadRef.get(ref) ?? []) {
        if (other.number !== pr.number) parent.set(find(pr.number), find(other.number));
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (const number of parent.keys()) push(groups, find(number), number);
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort((a, b) => a - b))
    .sort((a, b) => (a[0] as number) - (b[0] as number));
}

interface Candidate {
  pr: StackPr;
  /** 0 when the child targets the candidate's branch now; higher for older bases. */
  refRank: number;
  ref: string;
}

interface ParentChoice {
  pr: StackPr;
  ref: string;
  /** Set when the choice came down to which candidate is newest. */
  tiedWith: StackPr | null;
}

const STATE_RANK = { open: 2, merged: 1, closed: 0 } as const;

class Builder {
  private readonly byNumber = new Map<number, StackPr>();
  /** PRs that can be parents, by head branch. */
  private readonly byHeadRef = new Map<string, StackPr[]>();
  /** PRs by every branch they target or used to target. */
  private readonly byCandidateRef = new Map<string, StackPr[]>();
  private readonly parentCache = new Map<number, ParentChoice | null>();
  /** Children whose link to their parent was cut to break a cycle. */
  private readonly cut = new Set<number>();
  private readonly missing = new Map<string, FactRequest>();
  /** Reads that found no answer yet; a computation that bumps it is pending. */
  private unanswered = 0;
  private readonly issues: StackIssue[] = [];
  private readonly issueKeys = new Set<string>();

  constructor(
    private readonly index: PrIndex,
    private readonly facts: GitFacts,
  ) {
    for (const pr of index.prs) this.byNumber.set(pr.number, pr);
    for (const pr of this.byNumber.values()) {
      if (canBeParent(pr, index)) push(this.byHeadRef, pr.headRef, pr);
      for (const ref of candidateRefs(pr)) push(this.byCandidateRef, ref, pr);
    }
  }

  requests(): FactRequest[] {
    return [...this.missing.values()];
  }

  build(seed: StackSeed): Stack {
    const seedPr = this.resolveSeed(seed);
    const root = this.findRoot(seedPr);

    // The branch the bottom PR targets (or merged into), which is also where its anchor is found.
    const trunkName = root.baseRef;
    const isDefault = trunkName === this.index.defaultBranch;
    if (!isDefault) {
      this.issue(
        "non-default-trunk",
        [root.number],
        `#${root.number} targets ${trunkName}, not ${this.index.defaultBranch}.`,
        [prEvidence(root.number, `#${root.number} targets ${trunkName}`)],
      );
    }

    const base = this.rootAnchor(root);
    if (base === null) {
      this.issue(
        "missing-commit",
        [root.number],
        `Strata cannot find where #${root.number} left ${trunkName}.`,
        [prEvidence(root.number, `#${root.number}`)],
      );
    }

    const nodes: StackNode[] = [];
    const edges: StackEdge[] = [];
    /** Undefined while git facts are pending. */
    const anchors = new Map<number, string | null | undefined>();
    const visit = (pr: StackPr, parent: StackPr | null, depth: number, seen: Set<number>) => {
      seen.add(pr.number);
      let anchor: string | null | undefined;
      if (parent) {
        const choice = this.parentOf(pr) as ParentChoice;
        if (choice.tiedWith) {
          const other = choice.tiedWith;
          this.issue(
            "ambiguous-parent",
            [pr.number],
            `#${pr.number} could sit on #${parent.number} or #${other.number}. ` +
              `Strata selected #${parent.number}, the newer PR.`,
            [
              prEvidence(pr.number, `#${pr.number} targets ${choice.ref}`),
              prEvidence(parent.number, `#${parent.number}'s head is ${parent.headRef}`),
              prEvidence(other.number, `#${other.number}'s head is ${other.headRef}`),
            ],
          );
        }
        const edge = this.link(parent, pr, choice.ref, anchors.get(parent.number), trunkName);
        edges.push(edge.edge);
        anchor = edge.anchor;
      } else {
        anchor = base;
      }
      anchors.set(pr.number, anchor);
      const children = this.childrenOf(pr).filter((child) => !seen.has(child.number));
      nodes.push({
        pr,
        parent: parent?.number ?? null,
        children: children.map((child) => child.number),
        depth,
        anchor: anchor ?? null,
      });
      for (const child of children) visit(child, pr, depth + 1, seen);
    };
    visit(root, null, 0, new Set());

    const paths = rootToTipPaths(nodes);
    const selectedPath = this.selectPath(nodes, paths, seedPr, seed.leaf);

    return {
      id: stableId("stk", this.index.repo, String(root.number)),
      repo: this.index.repo,
      trunk: { name: trunkName, isDefault },
      root: root.number,
      base: base ?? null,
      nodes,
      edges,
      paths,
      selectedPath,
      seed: seedPr.number,
      issues: this.issues,
      notes: [],
    };
  }

  private resolveSeed(seed: StackSeed): StackPr {
    if ("pr" in seed) {
      const pr = this.byNumber.get(seed.pr);
      if (!pr) throw new StackError(`#${seed.pr} is not in the PR index for ${this.index.repo}.`);
      return pr;
    }
    const onBranch = this.index.prs.filter(
      (pr) => pr.headRef === seed.branch && !pr.crossRepository,
    );
    const pick =
      newest(
        onBranch.filter((pr) => pr.state === "open"),
        (pr) => pr.updatedAt,
      ) ??
      newest(
        onBranch.filter((pr) => pr.state === "merged"),
        (pr) => pr.mergedAt ?? "",
      ) ??
      newest(onBranch, (pr) => pr.closedAt ?? pr.updatedAt);
    if (!pick) throw new StackError(`No PR in ${this.index.repo} has ${seed.branch} as its head.`);
    return pick;
  }

  /** Follows parents down from the seed, cutting any cycle at its newest link. */
  private findRoot(seed: StackPr): StackPr {
    for (;;) {
      const walked: StackPr[] = [];
      const seen = new Set<number>();
      let current: StackPr | null = seed;
      while (current && !seen.has(current.number)) {
        seen.add(current.number);
        walked.push(current);
        current = this.parentOf(current)?.pr ?? null;
      }
      if (!current) return walked[walked.length - 1] as StackPr;

      // `current` was seen before: everything from it onwards is a cycle.
      const cycle = walked.slice(walked.findIndex((pr) => pr.number === current?.number));
      const newestChild = cycle.reduce((a, b) => (compareAge(b, a) > 0 ? b : a));
      this.cut.add(newestChild.number);
      const numbers = cycle.map((pr) => pr.number).sort((a, b) => a - b);
      this.issue(
        "cycle",
        numbers,
        `${numbers.map((n) => `#${n}`).join(", ")} target each other's branches. ` +
          `Strata removed the link below #${newestChild.number}, the newest PR.`,
        numbers.map((n) => prEvidence(n, `#${n}`)),
      );
    }
  }

  private parentOf(pr: StackPr): ParentChoice | null {
    if (this.cut.has(pr.number)) return null;
    if (this.parentCache.has(pr.number)) return this.parentCache.get(pr.number) ?? null;
    const choice = this.chooseParent(pr);
    this.parentCache.set(pr.number, choice);
    return choice;
  }

  private chooseParent(child: StackPr): ParentChoice | null {
    const candidates: Candidate[] = [];
    candidateRefs(child).forEach((ref, refRank) => {
      for (const pr of this.byHeadRef.get(ref) ?? []) {
        if (pr.number === child.number) continue;
        // An old base counts when GitHub retargeted the child because the parent
        // landed or closed, or when the child still holds the parent's work. A
        // PR moved off a parent that is still open has left it.
        if (refRank > 0 && pr.state === "open" && !this.holdsHead(pr, child)) continue;
        candidates.push({ pr, refRank, ref });
      }
    });
    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      const only = candidates[0] as Candidate;
      return { pr: only.pr, ref: only.ref, tiedWith: null };
    }

    const scored = candidates.map((c) => ({
      c,
      key: [
        -c.refRank,
        this.holdsHead(c.pr, child) ? 1 : 0,
        overlaps(c.pr, child) ? 1 : 0,
        STATE_RANK[c.pr.state],
      ],
    }));
    scored.sort((a, b) => compareKeys(b.key, a.key) || compareAge(b.c.pr, a.c.pr));
    const [best, next] = scored as [(typeof scored)[number], (typeof scored)[number]];
    // Only recency separated them: say so rather than guess silently.
    const tied = compareKeys(best.key, next.key) === 0;
    return { pr: best.c.pr, ref: best.c.ref, tiedWith: tied ? next.c.pr : null };
  }

  /** Whether the child holds the candidate's head, now or before a force-push. */
  private holdsHead(parent: StackPr, child: StackPr): boolean {
    if (this.isAncestor(parent.headOid, child.headOid) === true) return true;
    return parent.forcePushes.some((push) => this.isAncestor(push.before, child.headOid) === true);
  }

  private childrenOf(pr: StackPr): StackPr[] {
    const children = new Map<number, StackPr>();
    for (const candidate of this.byCandidateRef.get(pr.headRef) ?? []) {
      if (candidate.number === pr.number) continue;
      if (this.parentOf(candidate)?.pr.number === pr.number)
        children.set(candidate.number, candidate);
    }
    return [...children.values()].sort((a, b) => a.number - b.number);
  }

  /** Where the stack left the trunk. Undefined while git facts are pending. */
  private rootAnchor(root: StackPr): string | null | undefined {
    return this.whileAsking(() => this.baseMeet(root));
  }

  /**
   * Where a PR last met its current base: the base just before the PR merged,
   * or the base's tip now. Null when the base branch is gone.
   */
  private baseMeet(pr: StackPr): string | null {
    const from =
      pr.state === "merged" && pr.mergeCommitOid
        ? this.firstParent(pr.mergeCommitOid)
        : this.tip(pr.baseRef);
    return from ? (this.mergeBase(from, pr.headOid) ?? null) : null;
  }

  /** Runs `read` and returns undefined if it needed a fact that isn't answered yet. */
  private whileAsking<T>(read: () => T): T | undefined {
    const before = this.unanswered;
    const value = read();
    return this.unanswered > before ? undefined : value;
  }

  private link(
    parent: StackPr,
    child: StackPr,
    ref: string,
    parentAnchor: string | null | undefined,
    trunk: string,
  ): { edge: StackEdge; anchor: string | null | undefined } {
    const via = child.baseRef === ref ? "base-ref" : "retarget";
    const evidence: Evidence[] = [
      prEvidence(
        child.number,
        via === "base-ref"
          ? `#${child.number} targets ${ref}`
          : `#${child.number} was retargeted from ${ref}`,
      ),
      prEvidence(parent.number, `#${parent.number}'s head branch is ${ref}`),
    ];
    const before = this.unanswered;
    let link: LinkState = "unknown";
    let anchor: string | null = null;

    // A stack merged all at once lands each PR on the trunk, while GitHub keeps
    // the parent's branch as its base. Its head then links it like an open PR's.
    const landed = this.landedElsewhere(parent, child, trunk);
    if (typeof landed === "string") {
      evidence.push(commitEvidence(child.mergeCommitOid as string, landed));
    }
    if (child.state === "merged" && child.baseRef === ref && typeof landed !== "string") {
      // Null: git can't tell where it landed, so the link stays unknown and nothing is claimed.
      if (landed === false) {
        link = "merged-into-parent";
        const mergeCommit = child.mergeCommitOid as string;
        const into = this.firstParent(mergeCommit);
        anchor = into ? (this.mergeBase(into, child.headOid) ?? null) : null;
        evidence.push(commitEvidence(mergeCommit, `#${child.number} merged into ${ref}`));
        if (parent.mergedAt && child.mergedAt && child.mergedAt > parent.mergedAt) {
          this.issue(
            "base-already-merged",
            [child.number, parent.number],
            `Someone merged #${child.number} into ${ref} after #${parent.number} merged. ` +
              "Thus its changes did not go into the trunk.",
            evidence,
          );
        }
      }
    } else {
      const onBase = this.baseMeet(child);
      const inside = this.isAncestor(parent.headOid, child.headOid);
      // After the parent landed, the child was rebased onto its base or updated from it.
      const pastParent =
        onBase && onBase !== parent.headOid ? this.holdsWork(parent, onBase) : false;
      if (pastParent === true) {
        link = "re-anchored";
        anchor = onBase;
        evidence.push(
          commitEvidence(onBase as string, `where #${child.number} left ${child.baseRef}`),
        );
      } else if (inside === true) {
        link = "intact";
        anchor = parent.headOid;
        evidence.push(
          commitEvidence(parent.headOid, `#${parent.number}'s head, inside #${child.number}`),
        );
      } else if (inside === false && pastParent === false) {
        const met = this.lastMeet(parent, child, parentAnchor);
        if (met) {
          link = met.push ? "stale" : "behind";
          anchor = met.oid;
          evidence.push(
            met.push
              ? commitEvidence(met.push.before, `#${parent.number}'s head before a force-push`)
              : commitEvidence(met.oid, `where #${child.number} left #${parent.number}`),
            commitEvidence(parent.headOid, `#${parent.number}'s head now`),
          );
        } else if (met === null) {
          link = "re-anchored";
          anchor = onBase;
          if (onBase) {
            evidence.push(commitEvidence(onBase, `where #${child.number} left ${child.baseRef}`));
          }
        }
      }
      // A merged or closed PR can't be restacked; its link still places its changes.
      if (child.state === "open" && (link === "behind" || link === "stale")) {
        this.issue(
          "needs-restack",
          [child.number],
          link === "behind"
            ? `#${parent.number} has commits that #${child.number} does not have. #${child.number} needs a restack.`
            : `#${child.number} sits on a head that a force-push removed from #${parent.number}. #${child.number} needs a restack.`,
          evidence,
        );
      }
      if (child.state === "open" && child.baseRef === ref && parent.state === "merged") {
        this.issue(
          "base-already-merged",
          [child.number, parent.number],
          `#${child.number} still targets ${ref}, but #${parent.number} merged. ` +
            `Thus a merge of #${child.number} will not go into the trunk.`,
          evidence,
        );
      }
    }

    const pending = this.unanswered > before;
    if (!pending && (link === "unknown" || anchor === null)) {
      this.issue(
        "missing-commit",
        [child.number],
        `Strata cannot find where the own changes of #${child.number} start.`,
        evidence,
      );
    }
    return {
      edge: { parent: parent.number, child: child.number, via, ref, link, evidence },
      anchor: pending ? undefined : anchor,
    };
  }

  /**
   * Whether a merged child landed somewhere other than its parent's branch: on
   * the trunk, or on the branch of a PR further down (a stack that landed on a
   * branch with a PR of its own). Its merge commit is there and not in the
   * parent's head, where a child merged into the parent's branch would be. A
   * trunk that was deleted is checked through the default branch. Returns what
   * git shows, as the evidence's label, false when the child was merged into
   * the parent's branch, null when git can't tell, and undefined while facts
   * are pending.
   */
  private landedElsewhere(
    parent: StackPr,
    child: StackPr,
    trunk: string,
  ): string | false | null | undefined {
    if (child.state !== "merged") return false;
    const merge = child.mergeCommitOid;
    if (!merge) return null;
    const inParent = this.isAncestor(merge, parent.headOid);
    if (inParent === true) return false;
    let branch = trunk;
    let tip = this.tip(trunk);
    if (tip === null && trunk !== this.index.defaultBranch) {
      branch = this.index.defaultBranch;
      tip = this.tip(branch);
    }
    const onTrunk = tip ? this.isAncestor(merge, tip) : tip;
    // Every PR below is asked at once, so a deep stack takes one round.
    const below: Array<{ pr: StackPr; holds: boolean | null | undefined }> = [];
    const seen = new Set([child.number, parent.number]);
    for (
      let pr = this.parentOf(parent)?.pr;
      pr && !seen.has(pr.number);
      pr = this.parentOf(pr)?.pr
    ) {
      seen.add(pr.number);
      below.push({ pr, holds: this.isAncestor(merge, pr.headOid) });
    }
    if (inParent === undefined || onTrunk === undefined) return undefined;
    // Its merge commit says nothing about where the child went, only where it is.
    const on = `#${child.number}'s merge commit is on ${branch}`;
    if (onTrunk === true) return on;
    if (inParent === null || onTrunk === null) {
      // Strata's clone fetched the trunk just now, so a merge commit missing
      // from it isn't on the trunk: it went to a branch that's gone since.
      if (branch !== trunk || !tip) return null;
      const present = this.firstParent(merge);
      return present === undefined ? undefined : present === null ? false : null;
    }
    for (const { pr, holds } of below) {
      if (holds === undefined) return undefined;
      if (holds === true) return `#${child.number}'s merge commit is in #${pr.number}'s head`;
    }
    // Not being on the default branch says nothing about a deleted trunk.
    return branch === trunk ? false : null;
  }

  /** Whether `oid` holds the parent's work: its head, or the commit it landed as. */
  private holdsWork(parent: StackPr, oid: string): boolean | undefined {
    const head = this.isAncestor(parent.headOid, oid);
    const landed = parent.mergeCommitOid ? this.isAncestor(parent.mergeCommitOid, oid) : false;
    if (head === true || landed === true) return true;
    return head === undefined || landed === undefined ? undefined : false;
  }

  /**
   * The newest commit the child shares with the parent's own work (past where
   * the parent starts), through the parent's head now or one it force-pushed
   * away. Null when they share none; undefined when git can't tell yet.
   */
  private lastMeet(
    parent: StackPr,
    child: StackPr,
    parentAnchor: string | null | undefined,
  ): { oid: string; push: ForcePush | null } | null | undefined {
    if (parentAnchor === undefined) {
      this.unanswered++;
      return undefined;
    }
    const heads: { oid: string; push: ForcePush | null }[] = [
      { oid: parent.headOid, push: null },
      ...[...parent.forcePushes].reverse().map((push) => ({ oid: push.before, push })),
    ];
    const meets: { oid: string; push: ForcePush | null }[] = [];
    let unsure = false;
    for (const head of heads) {
      const met = this.mergeBase(head.oid, child.headOid);
      if (met === undefined) unsure = true;
      if (!met || meets.some((m) => m.oid === met)) continue;
      if (parentAnchor === null) {
        unsure = true;
        continue;
      }
      const before = this.isAncestor(met, parentAnchor);
      if (before === false) meets.push({ oid: met, push: head.push });
      else if (before !== true) unsure = true;
    }
    if (unsure) return undefined;
    const newest = meets.filter((a) =>
      meets.every((b) => b === a || this.isAncestor(b.oid, a.oid) === true),
    );
    if (meets.length === 0) return null;
    return newest.length === 1 ? newest[0] : undefined;
  }

  private selectPath(
    nodes: StackNode[],
    paths: number[][],
    seed: StackPr,
    leaf: number | undefined,
  ): number[] {
    const byNumber = new Map(nodes.map((node) => [node.pr.number, node]));
    const above = (n: number): StackNode[] => {
      const node = byNumber.get(n) as StackNode;
      return [node, ...node.children.flatMap(above)];
    };
    const reachable = above(seed.number);

    let tip: StackNode;
    if (leaf !== undefined) {
      const chosen = reachable.find((node) => node.pr.number === leaf);
      if (!chosen)
        throw new StackError(`#${leaf} is not at or above #${seed.number} in its stack.`);
      tip = chosen;
    } else {
      const tips = reachable.filter((node) => node.children.length === 0);
      const live = tips.filter((node) => node.pr.state !== "closed");
      tip = [...(live.length > 0 ? live : tips)].sort(
        (a, b) => b.pr.updatedAt.localeCompare(a.pr.updatedAt) || b.pr.number - a.pr.number,
      )[0] as StackNode;
    }

    if (tip.children.length === 0) {
      return paths.find((path) => path[path.length - 1] === tip.pr.number) as number[];
    }
    const path: number[] = [];
    for (let node: StackNode | undefined = tip; node; ) {
      path.unshift(node.pr.number);
      node = node.parent === null ? undefined : byNumber.get(node.parent);
    }
    return path;
  }

  private isAncestor(a: string, b: string): boolean | null | undefined {
    if (a === b) return true;
    return this.read(this.facts.isAncestor, factKey(a, b), { kind: "is-ancestor", a, b });
  }

  private mergeBase(a: string, b: string): string | null | undefined {
    if (a === b) return a;
    return this.read(this.facts.mergeBase, factKey(a, b), { kind: "merge-base", a, b });
  }

  private firstParent(oid: string): string | null | undefined {
    return this.read(this.facts.firstParent, oid, { kind: "first-parent", oid });
  }

  private tip(ref: string): string | null | undefined {
    return this.read(this.facts.tip, ref, { kind: "tip", ref });
  }

  /** Undefined means "asked for, not answered yet". */
  private read<T>(table: Record<string, T>, key: string, request: FactRequest): T | undefined {
    if (Object.hasOwn(table, key)) return table[key];
    this.missing.set(`${request.kind}:${key}`, request);
    this.unanswered++;
    return undefined;
  }

  private issue(kind: StackIssue["kind"], prs: number[], message: string, evidence: Evidence[]) {
    const key = `${kind}:${prs.join(",")}`;
    if (this.issueKeys.has(key)) return;
    this.issueKeys.add(key);
    this.issues.push({ kind, prs, message, evidence });
  }
}

/**
 * Same-repo PRs can be parents, except those from the default branch (a
 * release PR from main is not the bottom of every stack on main).
 */
function canBeParent(pr: StackPr, index: PrIndex): boolean {
  return !pr.crossRepository && pr.headRef !== index.defaultBranch;
}

/** The branches a PR targets now and used to target, most recent first. */
function candidateRefs(pr: StackPr): string[] {
  const refs = [pr.baseRef, ...pr.baseChanges.map((change) => change.from).reverse()];
  return [...new Set(refs)];
}

function overlaps(parent: StackPr, child: StackPr): boolean {
  const parentEnd = parent.mergedAt ?? parent.closedAt;
  const childEnd = child.mergedAt ?? child.closedAt;
  return (
    (parentEnd === null || child.createdAt <= parentEnd) &&
    (childEnd === null || parent.createdAt <= childEnd)
  );
}

/** Positive when `a` is newer than `b`. */
function compareAge(a: StackPr, b: StackPr): number {
  return a.createdAt.localeCompare(b.createdAt) || a.number - b.number;
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function newest(prs: StackPr[], when: (pr: StackPr) => string): StackPr | undefined {
  return [...prs].sort((a, b) => when(b).localeCompare(when(a)) || b.number - a.number)[0];
}

function rootToTipPaths(nodes: StackNode[]): number[][] {
  const byNumber = new Map(nodes.map((node) => [node.pr.number, node]));
  const root = nodes[0];
  if (!root) return [];
  const paths: number[][] = [];
  const walk = (node: StackNode, path: number[]) => {
    const next = [...path, node.pr.number];
    if (node.children.length === 0) paths.push(next);
    for (const child of node.children) walk(byNumber.get(child) as StackNode, next);
  };
  walk(root, []);
  return paths;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function prEvidence(number: number, label: string): Evidence {
  return { anchor: { source: { kind: "pr", number } }, label };
}

function commitEvidence(oid: string, label: string): Evidence {
  return { anchor: { source: { kind: "commit", oid } }, label };
}

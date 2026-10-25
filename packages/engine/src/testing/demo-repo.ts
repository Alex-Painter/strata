/**
 * A small repo with the stack shapes most tests need, served by a fake
 * GitHub: a three-PR chain whose bottom PR was squash-merged (its child was
 * retargeted, not rebased), a fork of two PRs on one parent, a lone PR, and a
 * fork-repo PR whose branch name matches the fork's parent.
 */
import type { PrNode } from "../github/graphql.js";
import { type FakeGitHub, fakeGitHub, ghTime, prNode, retargeted } from "./fake-github.js";
import type { StackRepo } from "./stack-repo.js";

export interface DemoRepo {
  github: FakeGitHub;
  /** Where main was when the chain branched. */
  m0: string;
  /** #1's squash commit, where the fork branched. */
  s1: string;
  heads: Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, string>;
}

export async function demoRepo(remote: StackRepo, repo = "acme/app"): Promise<DemoRepo> {
  const m0 = await remote.tip("main");
  const h1 = await remote.commit("b1", "main");
  const h2 = await remote.commit("b2", "b1");
  const h3 = await remote.commit("b3", "b2");
  const s1 = await remote.squashMerge("b1", "main");
  const h5 = await remote.commit("b5", "main");
  const h6 = await remote.commit("b6", "b5");
  const h7 = await remote.commit("b7", "b5");
  const h4 = await remote.commit("b4", "main");
  const h8 = await remote.commit("fork-b5", "main");
  const heads = { 1: h1, 2: h2, 3: h3, 4: h4, 5: h5, 6: h6, 7: h7, 8: h8 };
  for (const [n, oid] of Object.entries(heads)) await remote.holdPr(Number(n), oid);
  await remote.deleteBranch("b1");
  await remote.deleteBranch("fork-b5");

  const prs: PrNode[] = [
    prNode(1, h1, {
      title: "Add the forecast model",
      state: "MERGED",
      mergedAt: ghTime(30),
      closedAt: ghTime(30),
      updatedAt: ghTime(30),
      mergeCommit: { oid: s1 },
    }),
    prNode(2, h2, {
      title: "Add the forecast service",
      updatedAt: ghTime(31),
      timelineItems: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [retargeted("b1", "main", 31)],
      },
    }),
    prNode(3, h3, { title: "Add the forecast route", baseRefName: "b2" }),
    prNode(4, h4, { title: "Fix a typo" }),
    prNode(5, h5, { title: "Add billing admins" }),
    prNode(6, h6, { title: "Show admins in settings", baseRefName: "b5" }),
    prNode(7, h7, { title: "Email admins", baseRefName: "b5", updatedAt: ghTime(40) }),
    prNode(8, h8, { headRefName: "b5", isCrossRepository: true }),
  ];
  return { github: fakeGitHub(repo, prs), m0, s1, heads };
}

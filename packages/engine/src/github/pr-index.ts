/**
 * The PR index: every PR in a repo updated in the last 90 days, in every
 * state. Stacks are found from the whole repo, not from one PR's links,
 * because GitHub retargets a child when its merged parent's branch is
 * deleted, so the child's base alone no longer names its parent.
 *
 * The index is cached as JSON in the data folder. A refresh asks for PRs
 * newest-updated first and stops at the last fetch, so it is usually one
 * small query.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PrIndex, StackPr } from "@strata/core";
import {
  PR_PAGE_QUERY,
  PR_TIMELINE_QUERY,
  type PrNode,
  type PrPage,
  type PrTimelinePage,
  type TimelineNode,
  toStackPr,
} from "./graphql.js";
import { GitHubError, type GitHubPort } from "./port.js";

const CACHE_VERSION = 1;
const DAY = 24 * 60 * 60 * 1000;
/** Overlap with the last fetch, for PRs that changed while it ran. */
const SLACK = 10 * 60 * 1000;

interface CachedIndex {
  version: number;
  repo: string;
  defaultBranch: string;
  fetchedAt: string;
  prs: StackPr[];
}

export interface PrIndexOptions {
  port: GitHubPort;
  dataDir: string;
  /** Defaults to 90. */
  windowDays?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export async function loadPrIndex(repo: string, options: PrIndexOptions): Promise<PrIndex> {
  const [owner, name] = splitRepo(repo);
  const now = (options.now ?? (() => new Date()))();
  // Times are compared as numbers: GitHub's timestamps and toISOString() differ in format.
  const windowStart = now.getTime() - (options.windowDays ?? 90) * DAY;
  const path = cachePath(options.dataDir, owner, name);
  const cached = await readCache(path, repo);
  const stopAt = cached ? Math.max(windowStart, Date.parse(cached.fetchedAt) - SLACK) : windowStart;

  const fetched: StackPr[] = [];
  let defaultBranch = cached?.defaultBranch;
  let cursor: string | null = null;
  for (;;) {
    const page: PrPage = await options.port.graphql<PrPage>(PR_PAGE_QUERY, { owner, name, cursor });
    if (!page.repository)
      throw new GitHubError(`GitHub has no repo ${repo}, or the token can't see it.`);
    defaultBranch = page.repository.defaultBranchRef?.name ?? defaultBranch;
    const { nodes, pageInfo } = page.repository.pullRequests;
    let reachedOld = false;
    for (const node of nodes) {
      if (!node) continue;
      if (Date.parse(node.updatedAt) < stopAt) {
        reachedOld = true;
        break;
      }
      fetched.push(toStackPr(node, await allEvents(options.port, owner, name, node)));
    }
    if (reachedOld || !pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  if (!defaultBranch) throw new GitHubError(`${repo} has no default branch.`);

  const byNumber = new Map<number, StackPr>();
  for (const pr of cached?.prs ?? []) byNumber.set(pr.number, pr);
  for (const pr of fetched) byNumber.set(pr.number, pr);
  const prs = [...byNumber.values()]
    .filter((pr) => Date.parse(pr.updatedAt) >= windowStart)
    .sort((a, b) => a.number - b.number);
  options.log?.(
    `${repo}: ${fetched.length} PRs fetched, ${prs.length} in the ${options.windowDays ?? 90}-day index`,
  );

  await writeCache(path, {
    version: CACHE_VERSION,
    repo,
    defaultBranch,
    fetchedAt: now.toISOString(),
    prs,
  });
  return { repo, defaultBranch, prs };
}

export function splitRepo(repo: string): [owner: string, name: string] {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(repo);
  if (!match) throw new Error(`Expected owner/name, got "${repo}".`);
  return [match[1] as string, match[2] as string];
}

async function allEvents(
  port: GitHubPort,
  owner: string,
  name: string,
  node: PrNode,
): Promise<(TimelineNode | null)[]> {
  const events = [...node.timelineItems.nodes];
  let { hasNextPage, endCursor } = node.timelineItems.pageInfo;
  while (hasNextPage) {
    const page = await port.graphql<PrTimelinePage>(PR_TIMELINE_QUERY, {
      owner,
      name,
      number: node.number,
      cursor: endCursor,
    });
    const timeline = page.repository?.pullRequest?.timelineItems;
    if (!timeline) break;
    events.push(...timeline.nodes);
    ({ hasNextPage, endCursor } = timeline.pageInfo);
  }
  return events;
}

function cachePath(dataDir: string, owner: string, name: string): string {
  return join(dataDir, "github", owner, `${name}.prs.json`);
}

async function readCache(path: string, repo: string): Promise<CachedIndex | null> {
  try {
    const cached = JSON.parse(await readFile(path, "utf8")) as CachedIndex;
    return cached.version === CACHE_VERSION && cached.repo === repo ? cached : null;
  } catch {
    return null;
  }
}

async function writeCache(path: string, index: CachedIndex): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(index, null, 2)}\n`);
  await rename(temp, path);
}

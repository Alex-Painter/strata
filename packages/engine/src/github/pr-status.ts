/**
 * The live GitHub status of some PRs: open, merged or closed, draft, review
 * decision and checks. One GraphQL request reads up to STATUS_BATCH PRs, so
 * the Changes list stays fresh for about one request per repo.
 */
import type { PathPr } from "@strata/core";
import { CHECKS, REVIEWS } from "./graphql.js";
import type { GitHubPort } from "./port.js";
import { splitRepo } from "./pr-index.js";

/** PRs per request. GitHub allows far more aliases; this keeps each answer small. */
export const STATUS_BATCH = 100;

/** The fields of a PR that do not come from inference, as the Changes list keeps them. */
export type PrStatus = Pick<PathPr, "number" | "state" | "draft" | "review" | "checks" | "title">;

export interface StatusNode {
  number: number;
  title: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  commits: { nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] };
}

export interface StatusPage {
  repository: Record<string, StatusNode | null> | null;
}

/** The query for `count` PRs, as $n0, $n1, …; each answer is under the alias p0, p1, …. */
export function prStatusQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `, $n${i}: Int!`).join("");
  const fields = Array.from(
    { length: count },
    (_, i) => `
    p${i}: pullRequest(number: $n${i}) {
      number title state isDraft reviewDecision
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }`,
  ).join("");
  return `query StrataPrStatus($owner: String!, $name: String!${vars}) {
  repository(owner: $owner, name: $name) {${fields}
  }
}`;
}

/** Each PR GitHub still has, by number. A PR that GitHub cannot find is left out. */
export async function readPrStatus(
  port: GitHubPort,
  repo: string,
  numbers: number[],
): Promise<Map<number, PrStatus>> {
  const [owner, name] = splitRepo(repo);
  const unique = [...new Set(numbers)];
  const out = new Map<number, PrStatus>();
  for (let start = 0; start < unique.length; start += STATUS_BATCH) {
    const batch = unique.slice(start, start + STATUS_BATCH);
    const variables: Record<string, unknown> = { owner, name };
    batch.forEach((n, i) => {
      variables[`n${i}`] = n;
    });
    const page = await port.graphql<StatusPage>(prStatusQuery(batch.length), variables);
    for (const node of Object.values(page.repository ?? {})) {
      if (node) out.set(node.number, toStatus(node));
    }
  }
  return out;
}

const STATES = { OPEN: "open", MERGED: "merged", CLOSED: "closed" } as const;

function toStatus(node: StatusNode): PrStatus {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup?.state;
  return {
    number: node.number,
    title: node.title,
    state: STATES[node.state],
    draft: node.isDraft,
    review: node.reviewDecision ? REVIEWS[node.reviewDecision] : null,
    checks: rollup ? (CHECKS[rollup] ?? null) : null,
  };
}

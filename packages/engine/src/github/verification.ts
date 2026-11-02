/**
 * Reads what each PR on a stack's path carries as proof that it works: the
 * check runs and statuses on its head, deployments of its head, the latest
 * human reviews, a bot's verdict, a CI bot's test failure comment, and the
 * Verification sections of its body. One GraphQL query per ten PRs.
 *
 * Bots are read by their formats, not by trust: an Airspeed verdict is a JSON
 * comment pinned to a commit, a Blacksmith comment is a table of failing tests.
 */
import {
  type FileChange,
  type PrVerification,
  parsePrBody,
  stableId,
  type Verification,
  type VerificationItem,
  type VerificationResult,
  verificationFlags,
} from "@strata/core";
import type { GitHubPort } from "./port.js";

const FIELDS = `
  number url body createdAt lastEditedAt headRefOid
  commits(last: 1) { nodes { commit {
    oid committedDate
    statusCheckRollup { contexts(first: 100) { nodes {
      __typename
      ... on CheckRun {
        name status conclusion detailsUrl startedAt completedAt
        checkSuite { app { name } workflowRun { workflow { name } } }
      }
      ... on StatusContext { context state targetUrl description createdAt }
    } } }
    deployments(last: 10) { nodes {
      environment createdAt commitOid
      latestStatus { state environmentUrl logUrl createdAt }
    } }
  } } }
  latestReviews(first: 30) { nodes {
    author { __typename login } state submittedAt url commit { oid }
  } }
  reviews(last: 30) { nodes {
    author { __typename login } state body submittedAt url commit { oid }
  } }
  comments(last: 30) { nodes { author { __typename login } body createdAt updatedAt url } }`;

/** The query for up to ten PRs, as aliases `pr<number>`. */
export function verificationQuery(numbers: number[]): string {
  const prs = numbers.map((n) => `pr${n}: pullRequest(number: ${n}) {${FIELDS}\n}`).join("\n");
  return `query StrataVerification($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
${prs}
  }
}`;
}

interface Author {
  __typename: string;
  login: string;
}

export type ContextNode =
  | {
      __typename: "CheckRun";
      name: string;
      status: string;
      conclusion: string | null;
      detailsUrl: string | null;
      startedAt: string | null;
      completedAt: string | null;
      checkSuite: {
        app: { name: string } | null;
        workflowRun: { workflow: { name: string } } | null;
      } | null;
    }
  | {
      __typename: "StatusContext";
      context: string;
      state: string;
      targetUrl: string | null;
      description: string | null;
      createdAt: string;
    };

export interface DeploymentNode {
  environment: string | null;
  createdAt: string;
  commitOid: string;
  latestStatus: {
    state: string;
    environmentUrl: string | null;
    logUrl: string | null;
    createdAt: string;
  } | null;
}

export interface VerificationNode {
  number: number;
  url: string;
  body: string | null;
  createdAt: string;
  lastEditedAt: string | null;
  headRefOid: string;
  commits: {
    nodes: ({
      commit: {
        oid: string;
        committedDate: string;
        statusCheckRollup: { contexts: { nodes: (ContextNode | null)[] } } | null;
        deployments: { nodes: (DeploymentNode | null)[] } | null;
      };
    } | null)[];
  };
  latestReviews: {
    nodes: ({
      author: Author | null;
      state: string;
      submittedAt: string | null;
      url: string;
      commit: { oid: string } | null;
    } | null)[];
  } | null;
  reviews: {
    nodes: ({
      author: Author | null;
      state: string;
      body: string;
      submittedAt: string | null;
      url: string;
      commit: { oid: string } | null;
    } | null)[];
  } | null;
  comments: {
    nodes: ({
      author: Author | null;
      body: string;
      createdAt: string;
      updatedAt: string;
      url: string;
    } | null)[];
  } | null;
}

export interface VerificationPage {
  repository: Record<string, VerificationNode | null> | null;
}

/** Reads the verification of each PR, bottom first. Files decide the UI flag. */
export async function readVerification(
  port: GitHubPort,
  repo: string,
  prs: { number: number; files: FileChange[] | null }[],
): Promise<Verification> {
  const [owner, name] = repo.split("/");
  const nodes = new Map<number, VerificationNode>();
  const notes: string[] = [];
  for (let i = 0; i < prs.length; i += 10) {
    const batch = prs.slice(i, i + 10).map((pr) => pr.number);
    const page = await port.graphql<VerificationPage>(verificationQuery(batch), { owner, name });
    for (const n of batch) {
      const node = page.repository?.[`pr${n}`];
      if (node) nodes.set(n, node);
      else notes.push(`Strata cannot read the verification of #${n} from GitHub.`);
    }
  }
  return {
    prs: prs.flatMap(({ number, files }) => {
      const node = nodes.get(number);
      if (!node) return [];
      const base = toPrVerification(node);
      return [{ ...base, flags: verificationFlags(base, files) }];
    }),
    notes,
  };
}

/** One PR's items, before flags. */
export function toPrVerification(node: VerificationNode): Omit<PrVerification, "flags"> {
  const pr = node.number;
  const commit = node.commits.nodes[0]?.commit ?? null;
  const head = node.headRefOid;
  const headAt = commit?.oid === head ? commit.committedDate : null;
  const items: VerificationItem[] = [];

  if (commit?.oid === head) {
    items.push(...checks(pr, head, commit.statusCheckRollup?.contexts.nodes ?? []));
    items.push(...deployments(pr, commit.deployments?.nodes ?? []));
  }
  items.push(...humanReviews(pr, node));
  const verdict = airspeedVerdict(pr, node);
  if (verdict) items.push(verdict);
  const failures = blacksmithFailures(pr, node, head, headAt);
  if (failures) items.push(failures);
  items.push(...parsePrBody(pr, node.body, node.url));

  return {
    pr,
    head,
    bodyAt: node.lastEditedAt ?? node.createdAt,
    headAt,
    items,
  };
}

const CONCLUSION: Record<string, VerificationResult> = {
  SUCCESS: "pass",
  FAILURE: "fail",
  TIMED_OUT: "fail",
  ACTION_REQUIRED: "fail",
  STARTUP_FAILURE: "fail",
  NEUTRAL: "skipped",
  SKIPPED: "skipped",
  STALE: "skipped",
  CANCELLED: "skipped",
};

const STATUS_STATE: Record<string, VerificationResult> = {
  SUCCESS: "pass",
  FAILURE: "fail",
  ERROR: "fail",
  PENDING: "pending",
  EXPECTED: "pending",
};

function checks(pr: number, head: string, contexts: (ContextNode | null)[]): VerificationItem[] {
  // Re-runs leave one run per attempt: keep the latest of each name.
  const latest = new Map<string, VerificationItem>();
  for (const node of contexts) {
    if (!node) continue;
    let item: VerificationItem;
    if (node.__typename === "CheckRun") {
      const result =
        node.status !== "COMPLETED" ? "pending" : (CONCLUSION[node.conclusion ?? ""] ?? "skipped");
      const by = node.checkSuite?.app?.name;
      const at = node.completedAt ?? node.startedAt;
      item = {
        id: stableId("ver", String(pr), "check", node.name),
        pr,
        kind: "check",
        source: "check",
        title: node.name,
        result,
        strength: "observed",
        commit: head,
        ...(by ? { by } : {}),
        ...(at ? { at } : {}),
        ...(node.detailsUrl ? { url: node.detailsUrl } : {}),
      };
    } else {
      item = {
        id: stableId("ver", String(pr), "check", node.context),
        pr,
        kind: "check",
        source: "check",
        title: node.context,
        ...(node.description ? { detail: node.description } : {}),
        result: STATUS_STATE[node.state] ?? "skipped",
        strength: "observed",
        commit: head,
        at: node.createdAt,
        ...(node.targetUrl ? { url: node.targetUrl } : {}),
      };
    }
    const before = latest.get(item.title);
    if (!before || (item.at ?? "") >= (before.at ?? "")) latest.set(item.title, item);
  }
  // Failing first, then running, then the rest by name.
  const rank: Record<VerificationResult, number> = {
    fail: 0,
    pending: 1,
    pass: 2,
    claimed: 3,
    "not-run": 4,
    skipped: 5,
  };
  return [...latest.values()].sort(
    (a, b) => rank[a.result] - rank[b.result] || a.title.localeCompare(b.title),
  );
}

const DEPLOY_STATE: Record<string, VerificationResult> = {
  SUCCESS: "pass",
  ACTIVE: "pass",
  FAILURE: "fail",
  ERROR: "fail",
  PENDING: "pending",
  QUEUED: "pending",
  IN_PROGRESS: "pending",
  WAITING: "pending",
  INACTIVE: "skipped",
  DESTROYED: "skipped",
};

function deployments(pr: number, nodes: (DeploymentNode | null)[]): VerificationItem[] {
  const latest = new Map<string, VerificationItem>();
  for (const node of nodes) {
    if (!node) continue;
    const environment = node.environment ?? "Deployment";
    const status = node.latestStatus;
    const url = status?.environmentUrl || status?.logUrl || undefined;
    const item: VerificationItem = {
      id: stableId("ver", String(pr), "preview", environment),
      pr,
      kind: "preview",
      source: "deployment",
      title: environment,
      result: status ? (DEPLOY_STATE[status.state] ?? "pending") : "pending",
      strength: "observed",
      commit: node.commitOid,
      at: status?.createdAt ?? node.createdAt,
      ...(url ? { url } : {}),
    };
    const before = latest.get(environment);
    if (!before || (item.at ?? "") >= (before.at ?? "")) latest.set(environment, item);
  }
  return [...latest.values()];
}

function humanReviews(pr: number, node: VerificationNode): VerificationItem[] {
  return (node.latestReviews?.nodes ?? []).flatMap((review) => {
    if (!review?.author || review.author.__typename === "Bot") return [];
    if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED") return [];
    const approved = review.state === "APPROVED";
    return [
      {
        id: stableId("ver", String(pr), "human-review", review.author.login),
        pr,
        kind: "human-review" as const,
        source: "review" as const,
        title: approved
          ? `${review.author.login} approved`
          : `${review.author.login} requested changes`,
        result: approved ? ("pass" as const) : ("fail" as const),
        strength: "observed" as const,
        commit: review.commit?.oid ?? null,
        by: review.author.login,
        ...(review.submittedAt ? { at: review.submittedAt } : {}),
        url: review.url,
      },
    ];
  });
}

interface AirspeedVerdict {
  head_sha?: string;
  risk?: string;
  reason?: string;
  findings?: number;
  has_blocking_findings?: boolean;
  complete?: boolean;
}

/** The newest review with an `airspeed-verdict` JSON comment. */
function airspeedVerdict(pr: number, node: VerificationNode): VerificationItem | null {
  const reviews = (node.reviews?.nodes ?? []).filter((review) => review !== null);
  for (let i = reviews.length - 1; i >= 0; i--) {
    const review = reviews[i];
    const match = review
      ? /<!--\s*airspeed-verdict\s+(\{[\s\S]*?\})\s*-->/.exec(review.body)
      : null;
    if (!review || !match) continue;
    let verdict: AirspeedVerdict;
    try {
      verdict = JSON.parse(match[1] as string) as AirspeedVerdict;
    } catch {
      continue;
    }
    const findings = verdict.findings ?? 0;
    const parts = [
      verdict.risk ? `risk ${verdict.risk}` : null,
      findings === 1 ? "1 finding" : `${findings} findings`,
      verdict.has_blocking_findings ? "blocking" : null,
    ].filter(Boolean);
    return {
      id: stableId("ver", String(pr), "bot-review", "airspeed"),
      pr,
      kind: "bot-review",
      source: "review",
      title: `Airspeed Review: ${parts.join(", ")}`,
      ...(verdict.reason ? { detail: verdict.reason } : {}),
      result:
        verdict.complete === false ? "pending" : verdict.has_blocking_findings ? "fail" : "pass",
      strength: "observed",
      commit: verdict.head_sha ?? review.commit?.oid ?? null,
      by: review.author?.login ?? "airspeed",
      ...(review.submittedAt ? { at: review.submittedAt } : {}),
      url: review.url,
    };
  }
  return null;
}

/**
 * The newest Blacksmith comment that lists failing tests. It names no commit,
 * so Strata uses it only when it is newer than the head commit, and links it
 * to the head.
 */
function blacksmithFailures(
  pr: number,
  node: VerificationNode,
  head: string,
  headAt: string | null,
): VerificationItem | null {
  const comments = (node.comments?.nodes ?? []).filter((c) => c !== null);
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i];
    if (!comment?.body.includes("Blacksmith CI Status")) continue;
    const count = /Found (\d+) test failures?/.exec(comment.body);
    if (!count) return null;
    if (headAt && comment.updatedAt < headAt) return null;
    const tests = [...comment.body.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1] as string);
    const n = Number(count[1]);
    return {
      id: stableId("ver", String(pr), "test", "blacksmith"),
      pr,
      kind: "test",
      source: "comment",
      title: `Blacksmith: ${n === 1 ? "1 test fails" : `${n} tests fail`}`,
      ...(tests.length > 0
        ? { detail: `${tests.join("\n")}${tests.length < n ? `\n${n - tests.length} more` : ""}` }
        : {}),
      result: n > 0 ? "fail" : "pass",
      strength: "observed",
      commit: head,
      by: comment.author?.login ?? "blacksmith",
      at: comment.updatedAt,
      url: comment.url,
    };
  }
  return null;
}

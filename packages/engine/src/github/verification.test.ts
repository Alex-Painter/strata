import { describe, expect, it } from "vitest";
import { fakeGitHub, prNode } from "../testing/fake-github.js";
import {
  readVerification,
  toPrVerification,
  type VerificationNode,
  verificationQuery,
} from "./verification.js";

const HEAD = "7bc5ca46a817a7f36089913028ba087d0446d10d";
const OLD = "dc4d6008a766ba02b318198dd7b901a61a32484b";

const run = (
  name: string,
  conclusion: string | null,
  status = "COMPLETED",
  at = "2026-10-26T19:14:00Z",
) => ({
  __typename: "CheckRun" as const,
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/acme/app/actions/runs/1/job/${name.length}`,
  startedAt: at,
  completedAt: status === "COMPLETED" ? at : null,
  checkSuite: { app: { name: "GitHub Actions" }, workflowRun: null },
});

const bot = { __typename: "Bot", login: "airspeed-dev-bot" };
const verdict = (head: string, blocking: boolean) =>
  `<!-- airspeed-verdict {"version":3,"head_sha":"${head}","risk":"high","reason":"The PR changes request validation.","findings":${blocking ? 1 : 0},"draft":false,"complete":true,"has_blocking_findings":${blocking}} -->\n\n**TL;DR:** text`;

// Shaped like GlyphicAI/maverick-backend#9336 and #9660 on 2026-11-02.
const node: VerificationNode = {
  number: 9336,
  url: "https://github.com/acme/app/pull/9336",
  body: "## Testing\n\n- `pytest` passed locally.\n\nNot run: the live view on a phone.\n",
  createdAt: "2026-10-22T17:40:05Z",
  lastEditedAt: "2026-10-26T20:00:00Z",
  headRefOid: HEAD,
  commits: {
    nodes: [
      {
        commit: {
          oid: HEAD,
          committedDate: "2026-10-26T19:10:00Z",
          statusCheckRollup: {
            contexts: {
              nodes: [
                run("Backend CI / Unit tests", "SUCCESS"),
                run("Deploy backend", "SKIPPED"),
                // A re-run: the newer attempt wins.
                run("Backend CI / Lint backend", "FAILURE", "COMPLETED", "2026-10-26T19:11:00Z"),
                run("Backend CI / Lint backend", "SUCCESS", "COMPLETED", "2026-10-26T19:12:00Z"),
                run("Frontend CI", null, "IN_PROGRESS"),
                {
                  __typename: "StatusContext",
                  context: "netlify/deploy-preview",
                  state: "FAILURE",
                  targetUrl: "https://app.netlify.com/x",
                  description: "Deploy failed",
                  createdAt: "2026-10-26T19:13:00Z",
                },
              ],
            },
          },
          deployments: {
            nodes: [
              {
                environment: "preview-backend",
                createdAt: "2026-10-26T19:15:00Z",
                commitOid: HEAD,
                latestStatus: {
                  state: "SUCCESS",
                  environmentUrl: "https://preview.example/9336",
                  logUrl: null,
                  createdAt: "2026-10-26T19:16:00Z",
                },
              },
            ],
          },
        },
      },
    ],
  },
  latestReviews: {
    nodes: [
      {
        author: { __typename: "User", login: "Alex-Painter" },
        state: "APPROVED",
        submittedAt: "2026-10-26T15:23:37Z",
        url: "https://github.com/acme/app/pull/9336#pullrequestreview-1",
        commit: { oid: OLD },
      },
      {
        author: { __typename: "User", login: "dio" },
        state: "COMMENTED",
        submittedAt: "2026-10-26T15:00:00Z",
        url: "https://github.com/acme/app/pull/9336#pullrequestreview-2",
        commit: { oid: HEAD },
      },
      {
        author: bot,
        state: "COMMENTED",
        submittedAt: "2026-10-26T19:11:58Z",
        url: "https://github.com/acme/app/pull/9336#pullrequestreview-3",
        commit: { oid: HEAD },
      },
    ],
  },
  reviews: {
    nodes: [
      {
        author: bot,
        state: "COMMENTED",
        body: verdict(OLD, true),
        submittedAt: "2026-10-22T18:00:00Z",
        url: "https://github.com/acme/app/pull/9336#pullrequestreview-4",
        commit: { oid: OLD },
      },
      {
        author: bot,
        state: "COMMENTED",
        body: verdict(HEAD, false),
        submittedAt: "2026-10-26T19:11:58Z",
        url: "https://github.com/acme/app/pull/9336#pullrequestreview-5",
        commit: { oid: HEAD },
      },
    ],
  },
  comments: {
    nodes: [
      {
        author: { __typename: "Bot", login: "blacksmith-sh" },
        body: "<!-- Blacksmith CI Status -->\nFound 22 test failures on Blacksmith runners:\n\n| Test | View Logs |\n| --- | --- |\n| <code>test_a_tap_answers_its_question_once</code> | [View Logs](https://x) |\n| <code>test_an_expired_sign_in_link_is_gone</code> | [View Logs](https://x) |\n",
        createdAt: "2026-10-26T19:20:00Z",
        updatedAt: "2026-10-26T19:20:00Z",
        url: "https://github.com/acme/app/pull/9336#issuecomment-1",
      },
    ],
  },
};

function headCommit() {
  const commit = node.commits.nodes[0]?.commit;
  if (!commit) throw new Error("The test node has no commit.");
  return commit;
}

describe("toPrVerification", () => {
  it("maps checks, previews, reviews, the bot verdict, test failures and the body", () => {
    const v = toPrVerification(node);
    expect(v.head).toBe(HEAD);
    expect(v.bodyAt).toBe("2026-10-26T20:00:00Z");
    expect(v.headAt).toBe("2026-10-26T19:10:00Z");
    expect(
      v.items.map((item) => [
        item.kind,
        item.title,
        item.result,
        item.strength,
        item.commit === HEAD,
      ]),
    ).toEqual([
      ["check", "netlify/deploy-preview", "fail", "observed", true],
      ["check", "Frontend CI", "pending", "observed", true],
      ["check", "Backend CI / Lint backend", "pass", "observed", true],
      ["check", "Backend CI / Unit tests", "pass", "observed", true],
      ["check", "Deploy backend", "skipped", "observed", true],
      ["preview", "preview-backend", "pass", "observed", true],
      ["human-review", "Alex-Painter approved", "pass", "observed", false],
      ["bot-review", "Airspeed Review: risk high, 0 findings", "pass", "observed", true],
      ["test", "Blacksmith: 22 tests fail", "fail", "observed", true],
      ["test", "`pytest` passed locally.", "claimed", "claimed", false],
      ["not-run", "the live view on a phone.", "not-run", "claimed", false],
    ]);
    const preview = v.items.find((item) => item.kind === "preview");
    expect(preview?.url).toBe("https://preview.example/9336");
    const failures = v.items.find((item) => item.title.startsWith("Blacksmith"));
    expect(failures?.detail).toBe(
      "test_a_tap_answers_its_question_once\ntest_an_expired_sign_in_link_is_gone\n20 more",
    );
  });

  it("drops a Blacksmith comment older than the head commit", () => {
    const later = {
      ...node,
      commits: {
        nodes: [{ commit: { ...headCommit(), committedDate: "2026-10-27T00:00:00Z" } }],
      },
    };
    expect(toPrVerification(later).items.some((item) => item.title.startsWith("Blacksmith"))).toBe(
      false,
    );
  });

  it("reads no checks when GitHub's last commit is not the head", () => {
    const moved = { ...node, headRefOid: "f".repeat(40) };
    expect(toPrVerification(moved).items.some((item) => item.kind === "check")).toBe(false);
  });
});

describe("readVerification", () => {
  it("asks for ten PRs a query, and flags each PR", async () => {
    const prs = Array.from({ length: 12 }, (_, i) => prNode(i + 1, `${i}`.padStart(40, "0")));
    const github = fakeGitHub("acme/app", prs);
    github.verification[2] = { body: "## Verification\n\n- `pytest` passed.\n" };
    const result = await readVerification(github, "acme/app", [
      ...prs.map((pr) => ({ number: pr.number, files: null })),
      { number: 99, files: null },
    ]);
    expect(github.calls.filter((call) => call.query === "verification")).toHaveLength(2);
    expect(result.prs.map((pr) => pr.pr)).toEqual(prs.map((pr) => pr.number));
    expect(result.notes).toEqual(["Strata cannot read the verification of #99 from GitHub."]);
    expect(result.prs[1]?.flags.map((flag) => flag.kind)).toEqual(["no-checks", "claimed-only"]);
  });

  it("names each PR once in the query", () => {
    const query = verificationQuery([3, 4]);
    expect(query).toContain("pr3: pullRequest(number: 3)");
    expect(query).toContain("pr4: pullRequest(number: 4)");
  });
});

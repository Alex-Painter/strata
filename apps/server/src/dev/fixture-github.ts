/**
 * A stand-in GitHub for driving the app with no token or network. It builds
 * the engine's demo repo (acme/app) plus one stack that needs a restack and a
 * branch whose files the inspect rules flag, serves their PRs from a GraphQL
 * endpoint, and leaves the repo on disk for Strata to fetch from. The verify skill starts it with
 * `strata-verify up --github fixture`; point a dev server at it with
 * DEV_GITHUB_GRAPHQL_URL and DEV_GIT_REMOTE.
 *
 *   node --import tsx src/dev/fixture-github.ts [port]
 *
 * Prints `READY <graphql url> <git remote>` once it's listening, and deletes
 * the repo when stopped.
 *
 * It lists #4 and #10 as asking something of the token's user, and #3 as
 * reviewed by them, for the assignment search.
 *
 * It also stands in for Claude at POST /v1/messages (fixture-claude.ts): point
 * DEV_ANTHROPIC_BASE_URL at its origin, set any ANTHROPIC_API_KEY, and turn on
 * sendCodeToAnthropic for acme/app in the data folder's settings.
 */
import { createServer } from "node:http";
import { demoRepo, prNode, StackRepo } from "@strata/engine/testing";
import { fixtureChat, fixtureClaude, sseOf } from "./fixture-claude.js";

const remote = await StackRepo.create();
const demo = await demoRepo(remote);

// One more stack, with review and CI states and some code to read across
// several layers: #10 is behind #9, and #11 is a draft on top.
const lines = (...values: string[]) => `${values.join("\n")}\n`;
await remote.write(
  "b9",
  {
    "app/forecast_cache.py": lines(
      "from datetime import timedelta",
      "",
      "TTL = timedelta(hours=1)",
      "",
      "",
      "def cache_key(account_id: str) -> str:",
      '    return f"forecast:{account_id}"',
    ),
    "migrations/0042_forecast_cache.sql": lines(
      "create table forecast_cache (",
      "  account_id text primary key,",
      "  payload jsonb not null,",
      "  built_at timestamptz not null",
      ");",
    ),
  },
  "main",
);
const h10 = await remote.write(
  "b10",
  {
    "app/jobs/warm_cache.py": lines(
      "from app.forecast_cache import cache_key",
      "",
      "",
      "async def warm_all(accounts, cache, forecasts):",
      "    for account in accounts:",
      "        cache.set(cache_key(account.id), await forecasts.build(account))",
    ),
    "tests/test_warm_cache.py": lines(
      "from app.forecast_cache import cache_key",
      "",
      "",
      "def test_cache_key():",
      '    assert cache_key("a1") == "forecast:a1"',
    ),
    "uv.lock": lines(
      "version = 1",
      "",
      "[[package]]",
      'name = "apscheduler"',
      'version = "3.11.0"',
    ),
  },
  "b9",
);
// #11 also passes the TTL through, rewriting two of #10's lines.
const h11 = await remote.write(
  "b11",
  {
    "app/jobs/warm_cache.py": lines(
      "from app.forecast_cache import TTL, cache_key",
      "",
      "",
      "async def warm_all(accounts, cache, forecasts):",
      "    for account in accounts:",
      "        cache.set(cache_key(account.id), await forecasts.build(account), ttl=TTL)",
    ),
    "web/admin/CacheStats.tsx": lines(
      "export function CacheStats({ hits, misses }: { hits: number; misses: number }) {",
      "  const rate = hits + misses === 0 ? 0 : hits / (hits + misses);",
      "  return <p>Forecast cache hit rate: {Math.round(rate * 100)}%</p>;",
      "}",
    ),
  },
  "b10",
);
// #9 moves on after #10 branched from it.
const h9 = await remote.write("b9", {
  "app/forecast_cache.py": lines(
    "from datetime import timedelta",
    "",
    "TTL = timedelta(hours=6)",
    "",
    "",
    "def cache_key(account_id: str) -> str:",
    '    return f"forecast:v2:{account_id}"',
  ),
});
for (const [n, oid] of [
  [9, h9],
  [10, h10],
  [11, h11],
] as const) {
  await remote.holdPr(n, oid);
}
// A branch with no PR, for a range whose files the inspect rules flag:
// acme/app@main...inspect-demo.
await remote.write(
  "inspect-demo",
  {
    "app/auth/permissions.py": lines(
      "def can_see_forecast(user, account) -> bool:",
      "    return user.account_id == account.id",
    ),
    "migrations/0043_archive_sessions.sql": lines(
      "delete from sessions where expires_at < now() - interval '90 days';",
    ),
    "tests/test_permissions.py": lines(
      "def test_other_accounts_are_hidden(user, other_account):",
      "    assert not can_see_forecast(user, other_account)",
    ),
    "docs/retention.md": lines("# Retention", "", "Sessions are kept for 90 days."),
  },
  "main",
);
const rollup = (state: string) => ({ nodes: [{ commit: { statusCheckRollup: { state } } }] });
demo.github.prs.push(
  prNode(9, h9, {
    title: "Cache forecasts per account",
    reviewDecision: "APPROVED",
    commits: rollup("SUCCESS"),
    updatedAt: "2026-10-01T00:50:00Z",
  }),
  prNode(10, h10, {
    title: "Warm the forecast cache nightly",
    baseRefName: "b9",
    reviewDecision: "REVIEW_REQUIRED",
    commits: rollup("PENDING"),
    updatedAt: "2026-10-01T00:45:00Z",
  }),
  prNode(11, h11, {
    title: "Show cache hit rates in the admin page",
    baseRefName: "b10",
    isDraft: true,
    commits: rollup("FAILURE"),
    updatedAt: "2026-10-01T00:46:00Z",
  }),
);
for (const pr of demo.github.prs) {
  if (pr.number === 2)
    Object.assign(pr, { reviewDecision: "APPROVED", commits: rollup("SUCCESS") });
  if (pr.number === 3) {
    Object.assign(pr, { reviewDecision: "CHANGES_REQUESTED", commits: rollup("FAILURE") });
  }
}

// What GitHub lists for the verify bot, for the assignment search (strata-verify
// up --assigned acme/app): #10 in the middle of #9-#11 through a team, the
// lone #4 by name, and #3, which it has reviewed already.
demo.github.viewer = "verify-bot";
demo.github.requests = {
  3: { reviewedBy: ["verify-bot"] },
  4: { assignees: ["verify-bot"] },
  10: { teams: [{ slug: "acme/backend", members: ["verify-bot"] }] },
};

// The fixture's clock starts on 1 Oct 2026. Move every timestamp so the newest
// is an hour ago, keeping the PRs inside the 90 days Strata reads.
const newest = Math.max(...demo.github.prs.map((pr) => Date.parse(pr.updatedAt)));
const shift = Date.now() - 3_600_000 - newest;
demo.github.prs = demo.github.prs.map((pr) => shiftTimes(pr, shift));

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || (req.url !== "/graphql" && req.url !== "/v1/messages")) {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (req.url === "/v1/messages") {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" }).end(sseOf(fixtureChat(body)));
      return;
    }
    const answer = fixtureClaude(body);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
    return;
  }
  try {
    const { query, variables } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const data = await demo.github.graphql(query, variables ?? {});
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ errors: [{ message }] }));
  }
});

server.listen(Number(process.argv[2] ?? 0), "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  console.log(`READY http://127.0.0.1:${port}/graphql ${remote.dir}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.close();
    await remote.remove();
    process.exit(0);
  });
}

function shiftTimes<T>(value: T, ms: number): T {
  if (typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) {
    return new Date(Date.parse(value) + ms).toISOString().replace(/\.\d{3}Z$/, "Z") as T;
  }
  if (Array.isArray(value)) return value.map((item) => shiftTimes(item, ms)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shiftTimes(item, ms)]),
    ) as T;
  }
  return value;
}

/**
 * A stand-in GitHub for driving the app with no token or network. It builds
 * the engine's demo repo (acme/app) plus one stack that needs a restack,
 * serves their PRs from a GraphQL endpoint, and leaves the repo on disk for
 * Strata to fetch from. The verify skill starts it with
 * `strata-verify up --github fixture`; point a dev server at it with
 * DEV_GITHUB_GRAPHQL_URL and DEV_GIT_REMOTE.
 *
 *   node --import tsx src/dev/fixture-github.ts [port]
 *
 * Prints `READY <graphql url> <git remote>` once it's listening, and deletes
 * the repo when stopped.
 */
import { createServer } from "node:http";
import { demoRepo, prNode, StackRepo } from "@strata/engine/testing";

const remote = await StackRepo.create();
const demo = await demoRepo(remote);

// One more stack, with review and CI states: #10 is behind #9, and #11 is a draft on top.
await remote.commit("b9", "main");
const h10 = await remote.commit("b10", "b9");
const h11 = await remote.commit("b11", "b10");
// #9 moves on after #10 branched from it.
const h9 = await remote.commit("b9");
for (const [n, oid] of [
  [9, h9],
  [10, h10],
  [11, h11],
] as const) {
  await remote.holdPr(n, oid);
}
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

// The fixture's clock starts on 1 Oct 2026. Move every timestamp so the newest
// is an hour ago, keeping the PRs inside the 90 days Strata reads.
const newest = Math.max(...demo.github.prs.map((pr) => Date.parse(pr.updatedAt)));
const shift = Date.now() - 3_600_000 - newest;
demo.github.prs = demo.github.prs.map((pr) => shiftTimes(pr, shift));

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/graphql") {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
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

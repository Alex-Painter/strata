/**
 * One small feature built five ways, for the shape-invariance tests (SPEC.md,
 * "Benchmarks", 1). The feature looks like maverick's: a Beanie model field, a
 * service, a router, a test, a lockfile bump and a doc. Every shape starts
 * from the same main, and shapes 1 to 4 end with the same code.
 *
 * 1. `one-pr`: the whole feature in one PR.
 * 2. `stack`: four chained PRs, where #4 fixes a mistake made in #2.
 * 3. `squash-merged`: shape 2 with #1 squash-merged, main moved on, and #2
 *    retargeted to main but not rebased.
 * 4. `restacked`: shape 3 with #2 rebased onto main. #3 still sits on #2's
 *    old head.
 * 5. `fork`: shape 2 plus #5 on #2, so the stack has two paths.
 */
import type { PrNode } from "../github/graphql.js";
import {
  type FakeGitHub,
  fakeGitHub,
  forcePushed,
  ghTime,
  prNode,
  retargeted,
} from "./fake-github.js";
import { StackRepo } from "./stack-repo.js";

export type FeatureShape = "one-pr" | "stack" | "squash-merged" | "restacked" | "fork";

export interface ShapeRepo {
  remote: StackRepo;
  github: FakeGitHub;
  /** The PR whose stack is the feature: its top PR. */
  tip: number;
}

const lines = (...values: string[]) => `${values.join("\n")}\n`;

const MAIN = {
  "app/models/account.py": lines(
    "from beanie import Document",
    "",
    "",
    "class Account(Document):",
    "    name: str",
    "    email: str",
  ),
  "app/services/__init__.py": "",
  "app/routers/__init__.py": lines("from fastapi import APIRouter", "", "router = APIRouter()"),
  "uv.lock": lines("[[package]]", 'name = "beanie"', 'version = "1.26.0"'),
  "docs/forecasts.md": lines("# Forecasts", "", "Not built yet."),
};

/** The model field and the lockfile bump. */
const PART_1 = {
  "app/models/account.py": lines(
    "from beanie import Document",
    "",
    "",
    "class Account(Document):",
    "    name: str",
    "    email: str",
    "    forecast_enabled: bool = False",
  ),
  "uv.lock": lines("[[package]]", 'name = "beanie"', 'version = "1.27.0"'),
};

/** The service, with a mistake: it ignores the flag. */
const PART_2 = {
  "app/services/forecasts.py": lines(
    "from app.models.account import Account",
    "",
    "",
    "def forecast_for(account: Account) -> list[float]:",
    "    return [0.0] * 12",
  ),
};

/** The router and its test. */
const PART_3 = {
  "app/routers/forecasts.py": lines(
    "from app.routers import router",
    "from app.services.forecasts import forecast_for",
    "",
    "",
    '@router.get("/accounts/{account_id}/forecast")',
    "async def get_forecast(account_id: str) -> list[float]:",
    "    account = await Account.get(account_id)",
    "    return forecast_for(account)",
  ),
  "tests/test_forecasts.py": lines(
    "from app.services.forecasts import forecast_for",
    "",
    "",
    "def test_disabled_accounts_get_no_forecast(account):",
    "    account.forecast_enabled = False",
    "    assert forecast_for(account) == []",
  ),
};

/** The fix for #2's mistake, which rewrites #2's last line, and the doc. */
const PART_4 = {
  "app/services/forecasts.py": lines(
    "from app.models.account import Account",
    "",
    "",
    "def forecast_for(account: Account) -> list[float]:",
    "    return [0.0] * 12 if account.forecast_enabled else []",
  ),
  "docs/forecasts.md": lines(
    "# Forecasts",
    "",
    "`GET /accounts/{id}/forecast` returns twelve months, or nothing when",
    "forecasts are off for the account.",
  ),
};

/** A sibling of #3 for the fork. */
const PART_5 = {
  "app/services/export.py": lines(
    "from app.services.forecasts import forecast_for",
    "",
    "",
    "def export_csv(account) -> str:",
    '    return ",".join(str(v) for v in forecast_for(account))',
  ),
};

/** An unrelated change that lands on main while the stack is open. */
const ELSEWHERE = { "README.md": lines("# App", "", "Run `make dev`.") };

const TITLES: Record<number, string> = {
  1: "Add the forecast flag",
  2: "Add the forecast service",
  3: "Add the forecast route",
  4: "Fix forecasts for disabled accounts",
  5: "Export forecasts as CSV",
};

export async function featureShape(shape: FeatureShape): Promise<ShapeRepo> {
  const remote = await StackRepo.create();
  await remote.write("main", MAIN);

  if (shape === "one-pr") {
    const head = await remote.write("b1", { ...PART_1, ...PART_2, ...PART_3, ...PART_4 }, "main");
    await remote.holdPr(1, head);
    return {
      remote,
      github: fakeGitHub("acme/app", [prNode(1, head, { title: "Add account forecasts" })]),
      tip: 1,
    };
  }

  const h1 = await remote.write("b1", PART_1, "main");
  const h2 = await remote.write("b2", PART_2, "b1");
  const h3 = await remote.write("b3", PART_3, "b2");
  const h4 = await remote.write("b4", PART_4, "b3");
  const heads: Record<number, string> = { 1: h1, 2: h2, 3: h3, 4: h4 };
  const prs: Record<number, PrNode> = {};
  for (const n of [1, 2, 3, 4]) {
    prs[n] = prNode(n, heads[n] as string, {
      title: TITLES[n] as string,
      ...(n > 1 ? { baseRefName: `b${n - 1}` } : {}),
    });
  }

  if (shape === "fork") {
    const h5 = await remote.write("b5", PART_5, "b2");
    heads[5] = h5;
    prs[5] = prNode(5, h5, { title: TITLES[5] as string, baseRefName: "b2" });
  }

  if (shape === "squash-merged" || shape === "restacked") {
    const s1 = await remote.squashMerge("b1", "main");
    await remote.write("main", ELSEWHERE);
    await remote.deleteBranch("b1");
    prs[1] = prNode(1, h1, {
      title: TITLES[1] as string,
      state: "MERGED",
      mergedAt: ghTime(20),
      closedAt: ghTime(20),
      updatedAt: ghTime(20),
      mergeCommit: { oid: s1 },
    });
    prs[2] = prNode(2, h2, {
      title: TITLES[2] as string,
      updatedAt: ghTime(21),
      timelineItems: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [retargeted("b1", "main", 21)],
      },
    });
  }

  if (shape === "restacked") {
    const rebased = await remote.rebase("b2", "main", h1);
    heads[2] = rebased;
    prs[2] = prNode(2, rebased, {
      title: TITLES[2] as string,
      updatedAt: ghTime(22),
      timelineItems: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [retargeted("b1", "main", 21), forcePushed(h2, rebased, 22)],
      },
    });
  }

  for (const [n, oid] of Object.entries(heads)) await remote.holdPr(Number(n), oid);
  return { remote, github: fakeGitHub("acme/app", Object.values(prs)), tip: 4 };
}

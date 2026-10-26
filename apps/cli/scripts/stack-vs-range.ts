/**
 * The shape-invariance check on a real stack: analyses it, then the same
 * code given as a plain commit range, and compares their canonical reports
 * (see canonicalReport in @strata/core). They must be equal, because the
 * whole-stack view mustn't depend on how the work was split into PRs.
 *
 * The range runs from where the stack left its trunk to the tip PR's head
 * when every PR's diff is direct. Otherwise Strata replayed some PRs, and
 * the tip's head would bring in the trunk's own changes, so the range ends
 * at Strata's last commit on its chain instead, and says so.
 *
 *   pnpm --filter @strata/cli exec tsx scripts/stack-vs-range.ts <input> \
 *     [--repo-path <checkout>] [--leaf <n>] [--data-dir <dir>]
 *
 * It takes the same inputs and settings as `strata analyze`, writes nothing
 * but Strata's caches, and prints only where the reports differ, never what
 * they say, so its output names no code. Exits 0 when they're equal.
 */
import {
  type ChangeReport,
  canonicalReport,
  describeRepo,
  parseChangeInput,
  stableStringify,
} from "@strata/core";
import { parseCommand, resolvePaths, USAGE, UsageError } from "../src/args.js";
import { differences } from "../src/compare.js";
import { cliEngine, dataDirOf } from "../src/engine.js";

/** Differences printed, at most. */
const SHOWN = 20;

async function main(argv: string[]): Promise<number> {
  const cwd = process.env.INIT_CWD || process.cwd();
  let command: ReturnType<typeof parseCommand>;
  try {
    command = resolvePaths(parseCommand(["analyze", ...argv]), cwd);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (command.kind !== "analyze" || !command.input) {
    console.error("Give a stack, such as owner/repo#123.");
    return 2;
  }
  let input = parseChangeInput(command.input);
  if (input.kind === "range" || input.repo.kind !== "github") {
    console.error("Give a stack on GitHub, such as owner/repo#123, not a range.");
    return 2;
  }
  if (command.leaf !== undefined) {
    if (input.kind !== "stack-of") throw new UsageError("--leaf needs a PR or branch input.");
    input = { ...input, seed: { ...input.seed, leaf: command.leaf } };
  }
  const repo = describeRepo(input.repo);
  const engine = cliEngine({
    dataDir: dataDirOf(command.dataDir),
    ...(command.repoPath ? { checkouts: { [repo]: command.repoPath } } : {}),
  });
  const onProgress = (step: string) => console.error(`… ${step}`);

  const stack = await engine.analyzeChange(input, { onProgress });
  const path = stack.stack?.selectedPath ?? [];
  const revisions = stack.change.revisions;
  if (!stack.stack || !revisions) {
    console.error(
      "Strata couldn't build this stack's whole-stack diff, so there's nothing to compare.",
    );
    return 1;
  }
  const tip = stack.stack.nodes.find((node) => node.pr.number === path[path.length - 1]);
  const direct = stack.parts.every((part) => part.how === "direct");
  const head = direct && tip ? tip.pr.headOid : revisions.head;
  const range = await engine.analyzeChange(
    parseChangeInput(`${repo}@${revisions.base}...${head}`),
    { onProgress },
  );

  console.log(`Stack: ${repo}, ${path.map((n) => `#${n}`).join(" → ")}, ${files(stack)}`);
  console.log(
    `Range: ${repo}@${short(revisions.base)}...${short(head)}, ${files(range)}, ending at ` +
      (direct ? `#${tip?.pr.number}'s head` : "Strata's last commit, since some PRs were replayed"),
  );
  const a = canonicalReport(stack);
  const b = canonicalReport(range);
  if (stableStringify(a) === stableStringify(b)) {
    console.log("Same: the canonical reports are equal.");
    return 0;
  }
  const found = differences(a, b, SHOWN + 1);
  console.log(
    `Different: the canonical reports differ at ${found.length > SHOWN ? `${SHOWN}+` : found.length} places.`,
  );
  for (const at of found.slice(0, SHOWN)) console.log(`  ${at}`);
  return 1;
}

const short = (oid: string) => oid.slice(0, 7);
const files = (report: ChangeReport) =>
  report.change.files.length === 1 ? "1 file" : `${report.change.files.length} files`;

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

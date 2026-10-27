#!/usr/bin/env -S npx tsx
/**
 * strata: analyse a stack from the terminal, or list a repo's stacks.
 * `analyze` prints each PR's diff and the whole-stack diff in brief, then
 * writes the review page and the full report as JSON (see html.ts for where).
 */
import { parseChangeInput } from "@strata/core";
import { readCheckout } from "@strata/engine";
import { type Command, parseCommand, resolvePaths, USAGE, UsageError } from "./args.js";
import { cliEngine, dataDirOf } from "./engine.js";
import {
  injectReport,
  readTemplate,
  refuseCheckouts,
  reportPaths,
  reportsDir,
  writeOutput,
} from "./html.js";
import { progressPrinter } from "./progress.js";
import { formatReport } from "./report.js";
import { formatStacks } from "./stacks.js";

async function stacks(command: Extract<Command, { kind: "stacks" }>): Promise<void> {
  if (command.json) await refuseCheckouts([command.json]);
  const checkouts = command.repoPath ? { [command.repo]: command.repoPath } : undefined;
  const engine = cliEngine({
    dataDir: dataDirOf(command.dataDir),
    ...(checkouts ? { checkouts } : {}),
  });
  const found = await engine.discoverStacks(command.repo, { onProgress: progressPrinter() });
  process.stdout.write(formatStacks(command.repo, found));
  if (command.json) {
    const json = `${JSON.stringify({ repo: command.repo, stacks: found }, null, 2)}\n`;
    await writeOutput(command.json, json);
    console.error(`Wrote ${command.json}`);
  }
}

async function run(command: Extract<Command, { kind: "analyze" }>, cwd: string): Promise<void> {
  const dataDir = dataDirOf(command.dataDir);
  // Checked before the analysis, which can take minutes, and again once the
  // default paths are known.
  await refuseCheckouts([
    command.out ?? reportsDir(dataDir),
    ...(command.json ? [command.json] : []),
  ]);
  const template = await readTemplate();

  let checkout = command.repoPath;
  let raw = command.input;
  if (raw === undefined) {
    const found = await readCheckout(checkout ?? cwd);
    const give = "Give the input instead, such as owner/repo#123.";
    if (!found.repo) {
      throw new Error(
        `${found.root} has no remote on GitHub, so Strata can't tell the repo. ${give}`,
      );
    }
    if (!found.branch) throw new Error(`${found.root} isn't on a branch. ${give}`);
    raw = `${found.repo}:${found.branch}`;
    checkout = found.root;
    console.error(`… The stack around ${raw}, the branch checked out in ${found.root}`);
  }
  let input = parseChangeInput(raw, { localRepoPath: checkout ?? cwd });
  if (command.leaf !== undefined) {
    if (input.kind !== "stack-of") throw new UsageError("--leaf needs a PR or branch input.");
    input = { ...input, seed: { ...input.seed, leaf: command.leaf } };
  }
  const checkouts =
    checkout && input.repo.kind === "github"
      ? { [`${input.repo.owner}/${input.repo.name}`]: checkout }
      : undefined;
  // TODO(milestone 1): read command.sources into redacted context sources.
  const engine = cliEngine({ dataDir, ...(checkouts ? { checkouts } : {}) });
  const report = await engine.analyzeChange(input, { onProgress: progressPrinter() });
  process.stdout.write(formatReport(report));

  const paths = reportPaths(dataDir, report, {
    ...(command.out ? { out: command.out } : {}),
    ...(command.json ? { json: command.json } : {}),
  });
  await refuseCheckouts([paths.page, paths.json]);
  await writeOutput(paths.page, injectReport(template, report));
  await writeOutput(paths.json, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`Wrote ${paths.page}`);
  console.error(`Wrote ${paths.json}`);
}

async function main(argv: string[]): Promise<number> {
  // pnpm --filter runs the CLI in its own folder, and says where it was started.
  const cwd = process.env.INIT_CWD || process.cwd();
  let command: Command;
  try {
    command = resolvePaths(parseCommand(argv), cwd);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (command.kind === "help") {
    console.log(USAGE);
    return 0;
  }
  try {
    if (command.kind === "stacks") await stacks(command);
    else await run(command, cwd);
    return 0;
  } catch (error) {
    if (process.env.STRATA_DEBUG === "1") console.error(error);
    else console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));

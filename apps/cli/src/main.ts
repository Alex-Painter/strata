#!/usr/bin/env -S npx tsx
/**
 * strata: analyse a stack from the terminal, or list a repo's stacks.
 * `analyze` prints each PR's diff and the whole-stack diff in brief, and
 * writes the full report as JSON on request. The review page comes later.
 */
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseChangeInput } from "@strata/core";
import { createEngine } from "@strata/engine";
import { type Command, parseCommand, USAGE, UsageError } from "./args.js";
import { formatReport } from "./report.js";
import { formatStacks } from "./stacks.js";

function engineFor(
  command: Exclude<Command, { kind: "help" }>,
  checkouts?: Record<string, string>,
) {
  return createEngine({
    dataDir: path.resolve(command.dataDir ?? path.join(os.homedir(), ".strata")),
    ...(process.env.GITHUB_TOKEN ? { githubToken: process.env.GITHUB_TOKEN } : {}),
    ...(process.env.ANTHROPIC_API_KEY ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY } : {}),
    ...(checkouts ? { checkouts } : {}),
    log: (message) => console.error(message),
  });
}

async function stacks(command: Extract<Command, { kind: "stacks" }>): Promise<void> {
  const checkouts = command.repoPath
    ? { [command.repo]: path.resolve(command.repoPath) }
    : undefined;
  const found = await engineFor(command, checkouts).discoverStacks(command.repo);
  process.stdout.write(formatStacks(command.repo, found));
  if (command.json) {
    await writeFile(
      command.json,
      `${JSON.stringify({ repo: command.repo, stacks: found }, null, 2)}\n`,
    );
    console.error(`Wrote ${command.json}`);
  }
}

async function run(command: Extract<Command, { kind: "analyze" }>): Promise<void> {
  let input = parseChangeInput(command.input, {
    localRepoPath: path.resolve(command.repoPath ?? "."),
  });
  if (command.leaf !== undefined) {
    if (input.kind !== "stack-of") throw new UsageError("--leaf needs a PR or branch input.");
    input = { ...input, seed: { ...input.seed, leaf: command.leaf } };
  }
  const checkouts =
    command.repoPath && input.repo.kind === "github"
      ? { [`${input.repo.owner}/${input.repo.name}`]: path.resolve(command.repoPath) }
      : undefined;
  // TODO(milestone 1): read command.sources into redacted context sources,
  // and write the review page with injectReport (html.ts).
  const report = await engineFor(command, checkouts).analyzeChange(input, {
    onProgress: (step) => console.error(`… ${step}`),
  });
  process.stdout.write(formatReport(report));
  if (command.json) {
    await writeFile(command.json, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`Wrote ${command.json}`);
  }
}

async function main(argv: string[]): Promise<number> {
  let command: Command;
  try {
    command = parseCommand(argv);
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
    else await run(command);
    return 0;
  } catch (error) {
    if (process.env.STRATA_DEBUG === "1") console.error(error);
    else console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));

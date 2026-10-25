#!/usr/bin/env -S npx tsx
/**
 * strata: analyse a Change from the terminal and write a self-contained
 * review page, or list a repo's stacks. The analysis itself is still a stub,
 * so `analyze` reports that milestone 1 hasn't landed yet.
 */
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseChangeInput } from "@strata/core";
import { createEngine } from "@strata/engine";
import { type Command, parseCommand, USAGE, UsageError } from "./args.js";
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
  const input = parseChangeInput(command.input, {
    localRepoPath: path.resolve(command.repoPath ?? "."),
  });
  const engine = engineFor(command);
  // TODO(milestone 1): read command.sources into redacted context sources,
  // and write the review page with injectReport (html.ts).
  await engine.analyzeChange(input, { onProgress: (step) => console.error(`… ${step}`) });
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

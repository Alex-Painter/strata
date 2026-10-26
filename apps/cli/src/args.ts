/**
 * Command-line parsing, kept separate from main.ts so it can be tested
 * without running anything.
 */
import path from "node:path";
import { parseArgs } from "node:util";

export const USAGE = `Usage: strata analyze [input] [options]
       strata stacks <owner/repo> [options]

analyze: [input] is a PR (owner/repo#123 or its URL) or a branch
(owner/repo:feature/x), meaning the whole stack around it; an explicit
chain (owner/repo#12,13,14); or a commit range (owner/repo@main...feature).
With no input, it's the stack around the branch checked out in --repo-path,
or in the current folder. It prints the stack in brief, then writes the
review page and the full report as JSON. Needs GITHUB_TOKEN.

stacks: lists every stack among the PRs updated in the last 90 days. A
stack is a set of PRs whose branches feed into each other. Needs
GITHUB_TOKEN.

Strata never writes inside a git checkout, so a page of work code can't be
committed by accident.

Options:
  --repo-path <dir>     Local checkout of the repo, which Strata only reads:
                        it borrows its objects, and its branch when there's
                        no input
  --leaf <n>            For a stack that forks: the tip PR of the path to take
  --source <file>       Intent source (spec, ticket, notes); repeatable
  --out <file>          Review page to write (default: in reports/ in the
                        data folder)
  --json <file>         JSON to write (analyze: default next to the page;
                        stacks: none)
  --data-dir <dir>      Clone, cache and report folder (default: ~/.strata)
  -h, --help            Show this help`;

export type Command =
  | { kind: "help" }
  | { kind: "stacks"; repo: string; repoPath?: string; json?: string; dataDir?: string }
  | {
      kind: "analyze";
      /** Without one, the stack around the checkout's branch. */
      input?: string;
      repoPath?: string;
      leaf?: number;
      sources: string[];
      out?: string;
      json?: string;
      dataDir?: string;
    };

export class UsageError extends Error {}

export function parseCommand(argv: string[]): Command {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length === 0) return { kind: "help" };

  const [command, input, ...extra] = positionals;
  if (command !== "analyze" && command !== "stacks") {
    throw new UsageError(`Unknown command "${command}".`);
  }
  if (extra.length > 0) throw new UsageError(`Unexpected arguments: ${extra.join(" ")}`);

  if (command === "stacks") {
    if (!input) throw new UsageError("stacks needs an <owner/repo>.");
    if (!/^[\w.-]+\/[\w.-]+$/.test(input)) {
      throw new UsageError(`stacks needs a GitHub repo as owner/repo, got "${input}".`);
    }
    if (values.source || values.out || values.leaf) {
      throw new UsageError("stacks takes no --source, --out or --leaf.");
    }
    return {
      kind: "stacks",
      repo: input,
      ...(values["repo-path"] ? { repoPath: values["repo-path"] } : {}),
      ...(values.json ? { json: values.json } : {}),
      ...(values["data-dir"] ? { dataDir: values["data-dir"] } : {}),
    };
  }

  const leaf = values.leaf === undefined ? undefined : Number(values.leaf);
  if (leaf !== undefined && !(Number.isInteger(leaf) && leaf > 0)) {
    throw new UsageError(`--leaf needs a PR number, got "${values.leaf}".`);
  }
  return {
    kind: "analyze",
    ...(input ? { input } : {}),
    sources: values.source ?? [],
    ...(values.out ? { out: values.out } : {}),
    ...(values["repo-path"] ? { repoPath: values["repo-path"] } : {}),
    ...(leaf !== undefined ? { leaf } : {}),
    ...(values.json ? { json: values.json } : {}),
    ...(values["data-dir"] ? { dataDir: values["data-dir"] } : {}),
  };
}

/**
 * Makes the command's paths absolute against `cwd`. Through `pnpm --filter`,
 * the CLI runs in its own package folder, so main.ts passes the folder pnpm
 * was started in (INIT_CWD).
 */
export function resolvePaths<C extends Command>(command: C, cwd: string): C {
  if (command.kind === "help") return command;
  const next: Record<string, unknown> = { ...command };
  for (const key of ["repoPath", "out", "json", "dataDir"] as const) {
    const value = next[key];
    if (typeof value === "string") next[key] = path.resolve(cwd, value);
  }
  return next as C;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "repo-path": { type: "string" },
      leaf: { type: "string" },
      source: { type: "string", multiple: true },
      out: { type: "string" },
      json: { type: "string" },
      "data-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}

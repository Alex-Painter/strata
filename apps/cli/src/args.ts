/**
 * Command-line parsing, kept separate from main.ts so it can be tested
 * without running anything.
 */
import path from "node:path";
import { parseArgs } from "node:util";

export const USAGE = `Usage: strata analyze [input] [options]
       strata stacks <owner/repo> [options]

analyze: [input] is one of these:
  - A PR (owner/repo#123 or its URL) or a branch (owner/repo:feature/x).
    Strata uses the whole stack around it.
  - A chain of PRs (owner/repo#12,13,14).
  - A commit range (owner/repo@main...feature).
If you do not give an input, Strata uses the stack around the branch that
is checked out in --repo-path, or in the current folder. The command prints
a short form of the stack. Then it writes the review page and the full
report as JSON. You must set GITHUB_TOKEN.

stacks: lists all stacks in the PRs that changed in the last 90 days. A
stack is a set of PRs whose branches feed into each other. You must set
GITHUB_TOKEN.

Strata does not write in a git checkout. Thus nobody can commit a page of
work code by accident.

Options:
  --repo-path <dir>     Local checkout of the repo. Strata only reads it:
                        Strata uses its objects, and its branch when you
                        do not give an input
  --leaf <n>            For a stack that forks: the tip PR of the path to use
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
    throw new UsageError(`Strata does not know the command "${command}".`);
  }
  if (extra.length > 0)
    throw new UsageError(`Strata does not know these arguments: ${extra.join(" ")}`);

  if (command === "stacks") {
    if (!input) throw new UsageError("stacks must have an <owner/repo>.");
    if (!/^[\w.-]+\/[\w.-]+$/.test(input)) {
      throw new UsageError(`stacks must have a GitHub repo as owner/repo, not "${input}".`);
    }
    if (values.source || values.out || values.leaf) {
      throw new UsageError("stacks does not accept --source, --out or --leaf.");
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
    throw new UsageError(`--leaf must have a PR number, not "${values.leaf}".`);
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

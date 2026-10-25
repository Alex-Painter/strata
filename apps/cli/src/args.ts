/**
 * Command-line parsing, kept separate from main.ts so it can be tested
 * without running anything.
 */
import { parseArgs } from "node:util";

export const USAGE = `Usage: strata analyze <input> [options]
       strata stacks <owner/repo> [options]

analyze: <input> is a PR (owner/repo#123 or its URL), a stack
(owner/repo#12,13,14), or a commit range (owner/repo@main...feature, or
main...feature inside a local checkout).

stacks: lists every stack among the PRs updated in the last 90 days. A
stack is a set of PRs whose branches feed into each other. Needs
GITHUB_TOKEN.

Options:
  --repo-path <dir>     Local checkout: the repo for bare ranges, and for
                        GitHub repos a source of objects Strata only reads
  --source <file>       Intent source (spec, ticket, notes); repeatable
  --out <file>          Review page to write (default: strata-report.html)
  --json <file>         Also write the result as JSON
  --data-dir <dir>      Clone and cache directory (default: ~/.strata)
  -h, --help            Show this help`;

export type Command =
  | { kind: "help" }
  | { kind: "stacks"; repo: string; repoPath?: string; json?: string; dataDir?: string }
  | {
      kind: "analyze";
      input: string;
      repoPath?: string;
      sources: string[];
      out: string;
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
  if (!input)
    throw new UsageError(
      `${command} needs an <${command === "analyze" ? "input" : "owner/repo"}>.`,
    );
  if (extra.length > 0) throw new UsageError(`Unexpected arguments: ${extra.join(" ")}`);

  if (command === "stacks") {
    if (!/^[\w.-]+\/[\w.-]+$/.test(input)) {
      throw new UsageError(`stacks needs a GitHub repo as owner/repo, got "${input}".`);
    }
    if (values.source || values.out) throw new UsageError("stacks takes no --source or --out.");
    return {
      kind: "stacks",
      repo: input,
      ...(values["repo-path"] ? { repoPath: values["repo-path"] } : {}),
      ...(values.json ? { json: values.json } : {}),
      ...(values["data-dir"] ? { dataDir: values["data-dir"] } : {}),
    };
  }

  return {
    kind: "analyze",
    input,
    sources: values.source ?? [],
    out: values.out ?? "strata-report.html",
    ...(values["repo-path"] ? { repoPath: values["repo-path"] } : {}),
    ...(values.json ? { json: values.json } : {}),
    ...(values["data-dir"] ? { dataDir: values["data-dir"] } : {}),
  };
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "repo-path": { type: "string" },
      source: { type: "string", multiple: true },
      out: { type: "string" },
      json: { type: "string" },
      "data-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}

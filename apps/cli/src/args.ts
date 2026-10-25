/**
 * Command-line parsing, kept separate from main.ts so it can be tested
 * without running anything.
 */
import { parseArgs } from "node:util";

export const USAGE = `Usage: strata analyze <input> [options]

<input> is a PR (owner/repo#123 or its URL), a stack (owner/repo#12,13,14),
or a commit range (owner/repo@main...feature, or main...feature inside a
local checkout).

Options:
  --repo-path <dir>     Local checkout for bare ranges (default: current repo)
  --source <file>       Intent source (spec, ticket, notes); repeatable
  --out <file>          Review page to write (default: strata-report.html)
  --json <file>         Also write the report as JSON
  --data-dir <dir>      Clone and cache directory (default: ~/.strata)
  -h, --help            Show this help`;

export type Command =
  | { kind: "help" }
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
  if (command !== "analyze") throw new UsageError(`Unknown command "${command}".`);
  if (!input) throw new UsageError("analyze needs an <input>.");
  if (extra.length > 0) throw new UsageError(`Unexpected arguments: ${extra.join(" ")}`);

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

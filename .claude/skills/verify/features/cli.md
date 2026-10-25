# CLI

`strata` is the terminal entry point. A user runs `strata analyze <input>` to analyse a PR, a stack of PRs or a commit range and write a self-contained review page. In the scaffold, help, argument parsing and input validation are real. A valid input reaches the engine, which reports that analysis isn't implemented yet and writes nothing.

## Sub-features

- `cli-help`: `--help`, `-h` or no arguments print the usage text and exit 0.
- `cli-usage-errors`: an unknown command, a missing input, extra arguments or an unknown option print a message, then the usage text, and exit 2.
- `cli-input-validation`: input that isn't a PR, stack, URL or range prints the accepted forms and exits 1.
- `cli-analyze-stub`: valid input prints `Change analysis is not implemented yet (milestone 1).` and exits 1.

## How to get to it (user POV)

- From the repo: `pnpm --filter @strata/cli start <args>`. The README documents `pnpm --filter @strata/cli start --help`.
- `strata-verify cli <run> <name> <args>` runs the same entry, `apps/cli/src/main.ts`, through tsx with a clean environment and a throwaway `HOME`. Use this for proof.

## Driving it with strata-verify

Preconditions:

- Any run from `strata-verify up` (`$R`). The CLI doesn't talk to the server. The run only provides an evidence folder and an isolated `HOME`.

- **Help.** `strata-verify cli $R cli/help --help` exits `0` with stdout starting `Usage: strata analyze <input> [options]` and listing `--repo-path`, `--source`, `--out`, `--json`, `--data-dir` and `-h, --help`. `strata-verify cli $R cli/no-args` gives the same output.
- **Unknown command.** `strata-verify cli $R cli/unknown frobnicate` exits `2`. Stderr starts `Unknown command "frobnicate".` and is followed by the usage text.
- **Missing input.** `strata-verify cli $R cli/missing-input analyze` exits `2` with `analyze needs an <input>.`.
- **Extra arguments.** `strata-verify cli $R cli/extra analyze 'owner/repo#1' extra` exits `2` with `Unexpected arguments: extra`.
- **Unknown option.** `strata-verify cli $R cli/bad-option analyze 'owner/repo#1' --bogus` exits `2` with stderr starting `Unknown option '--bogus'.`.
- **Bad input.** `strata-verify cli $R cli/bad-input analyze not-a-thing` exits `1` with `Can't read "not-a-thing". Use owner/repo#123, owner/repo#12,13,14, a PR URL, owner/repo@base...head, or base...head inside a local checkout.`
- **Analyze stub.** `strata-verify cli $R cli/analyze-stub analyze 'owner/repo#1'` exits `1`. Stderr has `LLM steps disabled: no Anthropic API key` and `Change analysis is not implemented yet (milestone 1).` Side effect: `strata-verify capture $R cli/no-output -- ls -A /tmp/strata-verify/runs/$R/cli-data` lists nothing, and no `strata-report.html` appears in the working directory.

## Gotchas

- Quote `owner/repo#1`. An unquoted `#` starts a comment in zsh and bash, and the CLI then sees just `owner/repo`.
- Run it from zsh with a variable holding several words, and they reach the CLI as one argument. That produces misleading errors like `Unknown command "analyze owner/repo#1"`. Pass each argument separately.
- `pnpm --filter @strata/cli start` adds pnpm's own banner lines to stdout. Assert on the CLI's text, not on the first line.
- Once `analyze` is real it writes `--out` (default `strata-report.html` in the current directory) and clones into `--data-dir` (default `~/.strata`). Always pass `--out` and `--data-dir` inside the run dir so verification never writes into the repo or the real home.

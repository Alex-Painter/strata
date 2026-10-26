# CLI

`strata` is the terminal entry point. `strata stacks <owner/repo>` lists a repo's stacks, and `strata analyze <input>` finds the stack around a PR or branch and prints each PR's diff and the whole-stack diff in brief; `--json` writes the full report. The review page isn't written yet. Help, argument parsing, input validation, `stacks` and `analyze` are real. Both commands read GitHub with `GITHUB_TOKEN`, and without one they stop before writing anything.

## Sub-features

- `cli-help`: `--help`, `-h` or no arguments print the usage text and exit 0.
- `cli-usage-errors`: an unknown command, a missing input, extra arguments or an unknown option print a message, then the usage text, and exit 2.
- `cli-input-validation`: input that isn't a PR, stack, URL or range prints the accepted forms and exits 1.
- `cli-needs-token`: `analyze` and `stacks` without `GITHUB_TOKEN` say so and exit 1, writing nothing.
- `cli-stacks`: `strata stacks <owner/repo>` prints each stack as a tree, bottom PR first, with link states and issues. `--json <file>` also writes `{repo, stacks}`.
- `cli-analyze`: `strata analyze <input>` prints the path, one line per PR (how Strata built its diff, files, lines, title, and GitHub's reason when its diff differs), the whole-stack files by layer (with `(inspect)` on the layers to inspect and the reason a file is mechanical), the `Layers by PR` matrix (`↻N` lines changed again later, `+Nm` mechanical), issues and notes. `--leaf <n>` picks a fork's path; `--repo-path` lends a checkout's objects; `--json <file>` writes the report.

## How to get to it (user POV)

- From the repo: `pnpm --filter @strata/cli start <args>`. The README documents `pnpm --filter @strata/cli start --help`.
- `strata-verify cli <run> <name> <args>` runs the same entry, `apps/cli/src/main.ts`, through tsx with a clean environment and a throwaway `HOME`. Use this for proof.

## Driving it with strata-verify

Preconditions:

- Any run from `strata-verify up` (`$R`). The CLI doesn't talk to the server. The run only provides an evidence folder and an isolated `HOME`.

- **Help.** `strata-verify cli $R cli/help --help` exits `0` with stdout starting `Usage: strata analyze <input> [options]`, then `strata stacks <owner/repo> [options]`, and listing `--repo-path`, `--leaf`, `--source`, `--out`, `--json`, `--data-dir` and `-h, --help`. `strata-verify cli $R cli/no-args` gives the same output.
- **Unknown command.** `strata-verify cli $R cli/unknown frobnicate` exits `2`. Stderr starts `Unknown command "frobnicate".` and is followed by the usage text.
- **Missing input.** `strata-verify cli $R cli/missing-input analyze` exits `2` with `analyze needs an <input>.`.
- **Extra arguments.** `strata-verify cli $R cli/extra analyze 'owner/repo#1' extra` exits `2` with `Unexpected arguments: extra`.
- **Unknown option.** `strata-verify cli $R cli/bad-option analyze 'owner/repo#1' --bogus` exits `2` with stderr starting `Unknown option '--bogus'.`.
- **Bad input.** `strata-verify cli $R cli/bad-input analyze not-a-thing` exits `1` with `Can't read "not-a-thing". Use owner/repo#123, a PR URL, owner/repo:branch, owner/repo#12,13,14, owner/repo@base...head, or base...head inside a local checkout.`
- **No token.** `strata-verify cli $R cli/analyze-no-token analyze 'owner/repo#1'` exits `1` with stderr ending `Finding stacks needs a GitHub token (GITHUB_TOKEN).` `strata-verify cli $R cli/stacks-no-token stacks owner/repo` does the same. Side effect: `strata-verify capture $R cli/no-output -- ls -A /tmp/strata-verify/runs/$R/cli-data` lists nothing, and no `strata-report.html` appears in the working directory.
- **Stacks usage.** `strata-verify cli $R cli/stacks-missing stacks` exits `2` with `stacks needs an <owner/repo>.`; `stacks owner/repo --out x` exits `2` with `stacks takes no --source, --out or --leaf.`
- **Leaf.** `strata-verify cli $R cli/leaf-bad analyze 'owner/repo#1' --leaf x` exits `2` with `--leaf needs a PR number, got "x".`; `analyze 'owner/repo@main...b' --leaf 3` exits `1` with `--leaf needs a PR or branch input.`
- **Stacks on a real repo.** Only on the developer's Mac, where `gh` is signed in: `GITHUB_TOKEN="$(gh auth token)" pnpm --filter @strata/cli start stacks GlyphicAI/maverick-backend --repo-path ~/workspace/maverick-backend --data-dir <run dir>/cli-data`. Compare the trees with the hand-written proving stacks. `strata-verify cli` runs under `env -i`, so it can't pass the token; run this one directly and save the output with `strata-verify note`.
- **Analyze on a real repo.** Same machine and token: `GITHUB_TOKEN="$(gh auth token)" pnpm --filter @strata/cli start analyze 'GlyphicAI/maverick-backend#<tip>' --repo-path ~/workspace/maverick-backend --data-dir <run dir>/cli-data --json <run dir>/cli-data/report.json`. For each open PR whose part is `direct`, its files should match `gh pr diff <n> --name-only`; where they don't, the line under it gives GitHub's reason. Keep the output on the Mac: it names work files.

## Gotchas

- Quote `owner/repo#1`. An unquoted `#` starts a comment in zsh and bash, and the CLI then sees just `owner/repo`.
- Run it from zsh with a variable holding several words, and they reach the CLI as one argument. That produces misleading errors like `Unknown command "analyze owner/repo#1"`. Pass each argument separately.
- `pnpm --filter @strata/cli start` adds pnpm's own banner lines to stdout. Assert on the CLI's text, not on the first line.
- `analyze` and `stacks` clone into `--data-dir` (default `~/.strata`). `analyze` doesn't write `--out` yet. Always pass `--data-dir` (and `--json`) inside the run dir so verification never writes into the repo or the real home.
- The CLI has no stand-in GitHub; `analyze` on the demo stacks is covered by `apps/cli/src/report.test.ts`.

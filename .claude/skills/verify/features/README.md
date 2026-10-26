# Strata verification map

This directory is the maintained list of Strata's user-facing behaviour and how to prove each piece of it. Read this index before driving the app, then follow the matching feature file as the recipe. Real so far: sign-in, `/api/me`, `/healthz`, the app shell, the CLI (`stacks`, `analyze`, its review page and the stack vs range script), and stacks in the web app and API. Add a file when a milestone-1 feature lands.

## Baseline preconditions

- Start an instance with `.claude/skills/verify/scripts/strata-verify up`. Add `--mode oauth` for signed-out behaviour. The default bypass mode signs you in as `verify-bot`. Add `--github fixture` for anything that needs GitHub data (see [stacks.md](./stacks.md)).
- Run `strata-verify doctor <RUN_ID>` and require it to exit 0. Keep the printed `URL`: it's on a port from 8790 up.
- Never drive `localhost:5173` or `localhost:8787`. Those are the developer's own `pnpm dev`.
- Re-run `up` after editing code. The instance doesn't watch for changes.

## Driving conventions

- Web: use the built-in browser tools (`navigate`, `read_page`, `find`, `computer`) against the run's `URL`. Target elements by role and accessible name, never by coordinates.
- API: use `strata-verify http <run> <name> <METHOD> <path>`. It sends a same-origin `Origin` header and records the headers and body.
- CLI: use `strata-verify cli <run> <name> <args...>`. It runs in a clean environment with a throwaway `HOME`.
- Commands are literal. Quote `owner/repo#1` in zsh, or `#` starts a comment.

## Proof and skip reporting

- Name each piece of evidence `<feature>/<step>`, for example `sign-in/login-redirect`.
- API proof is the recorded status line, the relevant headers (`location`, `set-cookie`, `cache-control`) and the body.
- UI proof is the `read_page` tree plus the URL, saved with `strata-verify note`.
- CLI proof is the command, stdout, stderr and the exit code.
- If a step mutates something, prove it with a second, read-only view: the next request, a reload, or the SQLite file.
- Report an entry point you couldn't drive by naming the command you tried and the precondition it lacked. Don't report it as verified through some other path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then has exactly these four H2s in order:

1. `Sub-features`: short IDs with one line each.
2. `How to get to it (user POV)`.
3. `Driving it with strata-verify`: starts with `Preconditions:`, then labelled bullets that pair each action with the exact command and the result to expect.
4. `Gotchas`.

Keep implementation detail out. Name only user paths, stable handles, required state, commands and observable proof.

## Features

- [Sign-in](./sign-in.md) covers the signed-out screen, the GitHub redirect, auth error messages, the dev bypass and sign-out.
- [App shell and navigation](./app-shell.md) covers the home page, client-side routes, not-found pages and caching.
- [Stacks](./stacks.md) covers finding a stack from a PR or branch, a repo's stack list, the stack map, the PR pane, the path picker and the stack and Changes API.
- [API surface](./api-surface.md) covers `/healthz`, `/api/me`, the milestone-1 routes that still answer 501, auth gating and the CSRF check.
- [CLI](./cli.md) covers `strata --help`, usage errors, input validation and the `analyze` stub.

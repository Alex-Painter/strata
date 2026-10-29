---
name: verify
description: Drive the real Strata app (Hono API + React web app + `strata` CLI) in an isolated local instance and capture evidence that a change works the way a user sees it. Use after changing apps/server, apps/web, apps/cli or the packages they use, before claiming a feature, route, sign-in behaviour or CLI command works.
---

# Verify Strata

Strata has three user surfaces: the **web app** (primary: sign-in, the home page, a repo's stacks, the review workspace), the **JSON API** under `/api` and `/auth`, and the **`strata` CLI**. Real so far: sign-in, `/api/me`, `/healthz`, the app shell, stacks (finding them, the stack map, Changes and runs, each PR's diff and the whole-stack diff, layers, inspect flags, the layer by PR matrix, the summaries and the Guide) in the web app and API, and the assigned-Changes table on the home page, the Settings page (Claude per repo), Run again, and the CLI's `stacks` and `analyze` commands, with the review page `analyze` writes and the stack vs range script. Chat is real too (`features/chat.md`). Sources and files answer 501. Verify what is real, and when you build a milestone-1 feature, add a file for it under `features/` (see "Extending").

Everything goes through `scripts/strata-verify`, which lives next to this file. From the repo root:

```bash
V=.claude/skills/verify/scripts/strata-verify
$V help
```

## Isolation: never drive the developer's dev server

The developer usually has `pnpm dev` running: Vite on `localhost:5173` and the API on `localhost:8787`, with their own `.env` and SQLite data under `apps/server/.data`. **Don't drive those ports** and don't stop those processes. Vite's port and proxy target are hard-coded in `apps/web/vite.config.ts`, so a second dev stack can't run beside theirs.

Instead, `strata-verify up` starts its own production-shaped instance:

- One Node process (`node --import tsx apps/server/src/main.ts`) serves the API and its own web build on one origin, on a free port from 8790 up.
- It gets its own data dir and web build under `/tmp/strata-verify/runs/<RUN_ID>/instance/`.
- It runs under `env -i`, so the developer's `.env`, `ANTHROPIC_API_KEY` and GitHub credentials never reach it.

Any number of runs can be up at once.

Two auth modes:

| Mode               | Auth                                                                               | Use for                                                                     |
| ------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `bypass` (default) | `DEV_AUTH_BYPASS=1`, signed in as `verify-bot`                                     | everything behind sign-in: the Changes page, the workspace, `/api/*`        |
| `oauth`            | dummy GitHub OAuth app (`verify-dummy-client`), allowlist `verify-bot`, no session | the signed-out experience: sign-in screen, `/auth/login` redirect, 401s, auth errors |

The real GitHub round trip can't be completed by an agent. The dummy app gets you as far as the redirect to github.com; the callback is only verifiable for its error paths.

Where GitHub data comes from (`--github`, bypass mode only):

| Option           | Data                                                                                       | Use for                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `none` (default) | none: stack routes answer `Strata must have a GitHub token`                             | anything that doesn't touch a repo                            |
| `fixture`        | a stand-in GitHub (`apps/server/src/dev/fixture-github.ts`) serving the demo repo `acme/app` | stacks, Changes and the workspace, anywhere, with no token     |
| `gh`             | real GitHub with the token from `gh auth token`, passed only to the server's environment    | a real repo on the developer's Mac; add `--checkouts owner/name=path` |

Where Claude's answers come from (`--claude`, with `--github fixture` only):

| Option           | Answers                                                                                     | Use for                                                       |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `none` (default) | none: the page says there's no summary and shows Strata's own Guide                         | everything else                                               |
| `fixture`        | a stand-in Claude (`apps/server/src/dev/fixture-claude.ts`) on the fixture GitHub, answering from Strata's own prompts; `acme/app`'s settings turn on `sendCodeToAnthropic` | the summaries, the Guide and Claude's layers, with no key or cost |

## Launch

```bash
$V up                 # bypass mode; or: $V up --mode oauth, $V up --github fixture [--claude fixture] [--assigned acme/app]
# RUN_ID=20261025-091902-bypass-24552
# URL=http://localhost:8790
# MODE=bypass
# GITHUB=none
# CLAUDE=none
# EVIDENCE=/tmp/strata-verify/runs/<RUN_ID>/evidence
```

`up` builds the web app into the run dir (about 1s), starts the server, and returns only after `/healthz` answers. If the server doesn't come up, `up` prints the server log, tears the run down and exits 1. A config error lists every problem at once, prefixed `[strata]`.

The server isn't in watch mode. After editing code, run `down` and then `up` again, because the instance runs the code as it was at launch. That includes uncommitted changes, and doctor notes when the tree was dirty.

## Doctor

Run this first, and again whenever anything looks off. It is read-only and exits 1 if the instance isn't worth driving.

```bash
$V doctor <RUN_ID>    # or: $V doctor latest
```

It checks:

- the process is alive, and with `--github fixture` the stand-in GitHub too
- the port's listener is this run's PID, not someone else's
- `/healthz` returns `{"ok":true}`
- `/` serves the built shell (`<title>Strata</title>` plus `/assets/` scripts)
- `/api/me` returns 200 `verify-bot` in bypass mode, or 401 in oauth mode
- `HEAD` hasn't moved since launch

## Drive

**API.** `$V http <run> <name> <METHOD> <path> [curl args]` runs `curl -sS -i` against the instance, with a same-origin `Origin` header so POSTs pass the server's CSRF check the way the web app's do. Response headers are included in the evidence.

```bash
$V http latest me GET /api/me
$V http latest logout POST /auth/logout -H 'Content-Type: application/json' -d '{}'
```

**Web app.** Use the built-in browser (`mcp__Claude_Browser__*`). If it isn't available, use Claude in Chrome (`mcp__claude-in-chrome__*`). In a cloud session with neither, the environment may have Playwright and Chromium preinstalled (`require('playwright')`); drive the page from a script in your scratch folder, using roles and names as below, and save `page.locator('body').ariaSnapshot()` as the tree. Point any browser at the run's `URL`, never at 5173 or 8787.

- `navigate` to `URL` + path.
- `read_page` (filter `all`) for the accessibility tree.
- `find` with an accessible name to get a `ref`.
- `computer` `left_click` on that `ref`.

Stable handles in this app:

- The heading `Strata`, the link `Sign in with GitHub` (href `/auth/login`), and the auth error paragraph on the sign-in screen.
- The link `Strata` (top bar home), the button `Sign out`, and the signed-in login as text in the top bar.
- On the home page: `textbox "PR or branch"`, `button "Review"`, `textbox "Repository"`, `button "Show stacks"` and the heading `Changes`.
- On `/repos/<owner>/<name>`: one `article "Stack from #<n>"` per stack.
- On every page: `navigation "Strata"` (the sidebar) with `link "Changes"`, `link "Settings"` and `button "Collapse the sidebar"` (then `button "Expand the sidebar"` in the top bar). On `/settings`: one `region "<owner>/<name>"` per repo with `checkbox "Send the code in <owner>/<name> to Claude"`.
- On the home page's tables (`region "Waiting on you"` and the others): the columns `Change`, `Author`, `In stack`, `Opened`, `Status`, `Strata`, `GitHub`; `checkbox "Show team requests"` (its name gains `(<n> hidden)` when off); `link "Open #<n> on GitHub"`.
- In the workspace: the landmarks `complementary "Change"` (the Change pane), `main` and `complementary "Details"` (the side panel, toggled by `button "Side panel"` or `\`). The Change pane has `separator "Resize the pane"` (drag, or arrow keys; `aria-valuenow` is its width), `button "Collapse the pane"` (then `button "Expand the pane"`), `button "Whole stack"`, one button per layer with `data-layer` and its file count, and `list "Pull requests"`, whose rows carry `data-pr` and a `button "Show #<n> <title>"`. The side panel has `tab "Details"`, `tab "Ask"` (see `features/chat.md`) and, under Strata, `button "Run again"`; in the view bar `button "Display"`; `button "Command menu"` (⌘K) and `button "Keyboard shortcuts"` (`?`). Canvas stops for J and K carry `data-nav` (`file:<path>`, `hunk:<id>`, `claim:<text>`); the selected one has `aria-current="true"` or `aria-pressed="true"`.

There is no Playwright or headless Chrome in this repo. Don't add one just to verify.

**CLI.** `$V cli <run> <name> [args...]` runs `apps/cli/src/main.ts` through tsx under `env -i`, with `HOME` pointed at a throwaway dir, so `~/.strata` and any API keys in the shell are left alone. For a run started with `--github fixture` (and `--claude fixture`), it points the CLI at that run's stand-ins with dummy credentials. Exit codes: 0 for help, 2 for a usage error (the message is followed by the usage text), 1 for a runtime failure.

```bash
$V cli latest help --help
$V cli latest analyze-stub analyze owner/repo#1
```

**Anything else.** `$V capture <run> <name> -- <cmd...>` records any command the same way. For example, `sqlite3` on `/tmp/strata-verify/runs/<RUN_ID>/instance/data/strata.sqlite` to prove a row was written.

## Evidence

Every `http`, `cli` and `capture` call writes `<name>.cmd`, `.out`, `.err` and `.exit` under `/tmp/strata-verify/runs/<RUN_ID>/evidence/`, and echoes them. Names may contain `/` to group by feature, for example `sign-in/login-redirect`. Browser tools return their results to you rather than to a file, so save what you observed:

```bash
$V note latest app-shell/changes-page.aria.txt <<'EOF'
<read_page output, plus the URL you were on>
EOF
```

Proof standards:

- Drive the real user path: the browser for UI claims, real HTTP for API claims, the real CLI entry for CLI claims. Don't call handlers, query the DB in place of a visible result, or use test-only setters.
- Capture the action and the resulting state. For example, the redirect `Location` and then the page it lands on, not just the final screen.
- Check side effects alongside what's visible: the `Set-Cookie` header on logout, a new row in `strata.sqlite`, no file written by a CLI command that should write nothing.
- The only fake is the dummy GitHub OAuth app, because the GitHub boundary can't be crossed locally. Don't mock anything else.
- A feature file can list several entry points (browser, API, CLI). Only report the ones you actually drove as verified. Name any you skipped and say why.

## Cleanup

```bash
$V down <RUN_ID>      # kills only this run's PID, deletes its data dir, build and CLI home
$V list               # every run, up or down, with where its evidence is
```

`down` copies `server.log` into `evidence/` first. Evidence stays under `/tmp/strata-verify/runs/<RUN_ID>/evidence/` after `down`, so link to it in your report. Never `pkill node` or kill whatever is on a port: that would take down the developer's `pnpm dev`. Run `down` after every failed attempt too, so ports don't pile up. Delete `/tmp/strata-verify` only when nobody needs the evidence.

## Feature map

[`features/README.md`](features/README.md) indexes the user-facing features and how to prove each one. Read it before driving, and follow the matching file.

## Extending (milestone 1 and later)

When a 501 route or the `analyze` stub becomes real:

1. Add or update a file in `features/` with the four standard sections. The README describes them.
2. Remove the route from the "still 501" list in `features/api-surface.md`.
3. If the feature needs GitHub data, use `up --github fixture`, and extend `apps/server/src/dev/fixture-github.ts` when it needs a shape the demo repo lacks. Use `--github gh` only for a real repo on the developer's machine. Never write a token into evidence.
4. If it needs the LLM, the instance runs with it off by default. Opt in explicitly and note the model in the evidence.

# Strata

Strata is a system change review tool. Its core object is a **Change**: one feature, which may span many PRs and lives on past merge. Instead of reviewing a diff file by file, Strata classifies hunks into architectural layers, separates mechanical edits from meaningful ones, shows the before/after data model, and checks the change against its stated intent, with every claim linked back to evidence. The result should be the same no matter how the feature was split into PRs.

See [SPEC.md](SPEC.md) for the product and [docs/architecture.md](docs/architecture.md) for how the code is laid out.

## Status

Milestone 1, the stack view, is built and checked against fixtures (see [docs/architecture.md](docs/architecture.md#milestone-1-the-stack-view)); it still needs checking on a real repo. Context sources, chat and ranges in the web app answer "not implemented yet".

## Layout

```
packages/core     Domain model and shared types (Change, layers, anchors, report, chat, API)
packages/engine   Analysis engine: PR index, git cache, stacks, diffs, layers, summaries
apps/server       Hono API: GitHub sign-in, sessions, SQLite, serves the web build
apps/web          Vite + React single-page app
apps/cli          `strata` command: prints a stack or range and writes a self-contained review page
```

## Quick start

Needs Node 22.12 or newer and pnpm 10 (`corepack enable` picks up the pinned version).

```sh
pnpm install
cp .env.example .env   # then set DEV_GITHUB_LOGIN to your GitHub login
pnpm dev
```

Open http://localhost:5173. With `DEV_AUTH_BYPASS=1` you're signed in as `DEV_GITHUB_LOGIN` without going through GitHub. The web dev server proxies `/api` and `/auth` to the API server on port 8787.

## Scripts

| Command                                    | What it does                                                       |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `pnpm dev`                                 | API server (tsx watch) and web dev server together                 |
| `pnpm build`                               | Builds every package that has a build step                         |
| `pnpm typecheck`                           | `tsc` in every package                                             |
| `pnpm test`                                | All tests, through vitest projects                                 |
| `pnpm lint`                                | Biome lint and format check                                        |
| `pnpm format`                              | Biome with fixes applied                                           |
| `pnpm --filter @strata/server db:generate` | Generates a migration after editing `apps/server/src/db/schema.ts` |
| `pnpm --filter @strata/cli start --help`   | Runs the CLI                                                       |

## The CLI

```sh
GITHUB_TOKEN="$(gh auth token)" pnpm --filter @strata/cli start analyze 'owner/repo#123' --repo-path ~/work/repo
```

`analyze` takes a PR, a branch (`owner/repo:feature/x`), a chain (`owner/repo#12,13,14`) or a range (`owner/repo@main...feature`). With no input, it's the stack around the branch checked out in `--repo-path`, or in the folder you run it from. It prints the stack in brief, then writes the review page and the report as JSON to `reports/<owner>/<name>/` in the data folder (`~/.strata`, or `--data-dir`); `--out` and `--json` choose other paths. Strata won't write inside a git checkout, so a page of work code can't be committed by accident. The page is the web app's static build with the report in it, so build that first: `pnpm --filter @strata/web build`.

`strata stacks owner/repo` lists a repo's stacks. Both commands only read a checkout; Strata keeps its own clone in the data folder.

To check that a real stack gives the same whole-stack view as the same code given as a plain range:

```sh
GITHUB_TOKEN="$(gh auth token)" pnpm --filter @strata/cli exec tsx scripts/stack-vs-range.ts 'owner/repo#123' --repo-path ~/work/repo
```

It prints the stack's path and the range it compared, then any of the stack's notes on how the work was split as `Note: …`. Then it prints `Same: the canonical reports are equal.` and exits 0, or lists where they differ (places only, never code) and exits 1. When some PRs couldn't be put on the stack, it compares only the PRs in the whole-stack diff and says so, as in `Same, but only for #1 → #2: #3 isn't in the whole-stack diff.`, and exits 1.

## Repo settings

Each repo can have its own settings, kept in Strata's data folder rather than in the repo: `settings/<owner>/<name>.json` under `~/.strata` for the CLI (or `--data-dir`), and under `DATA_DIR` (`.data` in dev) for the server. Without the file, everything is off.

```json
{
  "layerRules": [
    {
      "id": "billing",
      "layer": "data-model",
      "paths": ["billing/**"],
      "reason": "Billing is always inspected"
    }
  ],
  "sendCodeToAnthropic": true
}
```

- `layerRules` run before Strata's own rules. `layer` is one of `data-model`, `api`, `logic`, `ui`, `tests`, `config`, `docs` or `other`, and `reason` is shown next to every file the rule matches.
- `sendCodeToAnthropic` lets Strata send the repo's code to the Anthropic API. Claude then chooses the layer of files no rule matched (from their paths and first changed lines), and writes the summary and the Guide's sections from the whole-stack diff and a summary of each PR from its own diff. It also needs `ANTHROPIC_API_KEY`. Answers are cached in the data folder, so the same stack isn't asked about twice. Without it, there's no summary and the Guide is Strata's own groups.

## GitHub sign-in

1. Create an OAuth App at https://github.com/settings/developers.
2. Set the callback URL to `<PUBLIC_URL>/auth/callback`. Locally that's `http://localhost:5173/auth/callback`.
3. Put `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ALLOWED_GITHUB_LOGINS` in `.env`, and remove `DEV_AUTH_BYPASS`.

Only logins in `ALLOWED_GITHUB_LOGINS` can sign in. The app asks for the `repo` and `read:user` scopes so it can read private repositories; the token is stored encrypted with a key derived from `SESSION_SECRET`.

## Deploying to Railway

The repo deploys as one service built from the `Dockerfile` (`railway.json` sets the builder and the `/healthz` health check).

- Attach a volume mounted at `/data`. It holds the SQLite database and, later, the git clone cache.
- The image runs as the `node` user and Railway volumes mount as root, so set `RAILWAY_RUN_UID=0`.
- Set `PUBLIC_URL` (the service's public domain), `SESSION_SECRET` (`openssl rand -base64 48`), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_GITHUB_LOGINS`, and optionally `ANTHROPIC_API_KEY`.
- Point the GitHub OAuth App's callback at `<PUBLIC_URL>/auth/callback`.

The server refuses to start in production if any required setting is missing, and lists every problem at once.

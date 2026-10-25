# Strata

Strata is a system change review tool. Its core object is a **Change**: one feature, which may span many PRs and lives on past merge. Instead of reviewing a diff file by file, Strata classifies hunks into architectural layers, separates mechanical edits from meaningful ones, shows the before/after data model, and checks the change against its stated intent, with every claim linked back to evidence. The result should be the same no matter how the feature was split into PRs.

See [SPEC.md](SPEC.md) for the product and [docs/architecture.md](docs/architecture.md) for how the code is laid out.

## Status

Scaffolding for milestone 1. Sign-in, the database, the web shell and the deploy setup work; the analysis engine and most API routes are stubs that answer "not implemented yet".

## Layout

```
packages/core     Domain model and shared types (Change, layers, anchors, report, chat, API)
packages/engine   Analysis engine contract; stubbed for now
apps/server       Hono API: GitHub sign-in, sessions, SQLite, serves the web build
apps/web          Vite + React single-page app
apps/cli          `strata` command that will write a self-contained review page
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

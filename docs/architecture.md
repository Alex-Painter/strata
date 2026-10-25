# Architecture

This describes the scaffold and the shape milestone 1 will fill in. [SPEC.md](../SPEC.md) is the source of truth for what Strata does; this file is about where the code for it goes.

## Stack

| Concern     | Choice                                             | Why                                                                                                                                    |
| ----------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Language    | TypeScript everywhere                              | One type model shared by engine, server, web and CLI. Python stays an option for an analysis step if a parser makes it clearly better. |
| Repo        | pnpm workspace                                     | Packages export their TypeScript source directly, so there is no build step between them.                                              |
| API server  | Hono on Node                                       | Small, typed, standard `Request`/`Response`; serves the API, the web build and (later) background jobs from one process.               |
| Web         | Vite + React SPA                                   | Fast dev loop; the same build also produces a single-file page the CLI can fill with a report.                                         |
| Sign-in     | GitHub OAuth via Arctic, server-side sessions      | One user for now, gated by an allowlist.                                                                                               |
| Storage     | SQLite (better-sqlite3) with Drizzle               | One file on a volume; no database service to run.                                                                                      |
| LLM         | Anthropic SDK, only for the fuzzy parts            | Deterministic analysis first (CLAUDE.md).                                                                                              |
| Tests       | vitest projects                                    | One `pnpm test` across every package.                                                                                                  |
| Lint/format | Biome                                              | One tool, fast.                                                                                                                        |
| Hosting     | Railway, one Dockerfile service, volume at `/data` |                                                                                                                                        |

## Packages

```
packages/core     Types and small pure helpers. No dependencies, runs in Node and the browser.
packages/engine   Turns a ChangeInput into a ChangeReport, and answers chat. Node only.
apps/server       HTTP API, auth, persistence, jobs. Calls the engine.
apps/web          The workspace UI. Talks to the server, or reads a report embedded in the page.
apps/cli          Runs the engine locally and writes a self-contained review page.
```

Dependencies only point downwards: `web → core`, `server → engine → core`, `cli → engine → core`.

### core

`packages/core/src/model/` holds the domain model:

- `change.ts`: a **Change** is built from the net diff between the merge base and the head. PR boundaries are kept as `ChangeHint`s and never used to group or order anything, which is what makes shape invariance possible.
- `layers.ts`: the semantic layers (data model, API, logic, UI, tests, config, docs, other), their order, and which ones need mandatory inspection.
- `anchors.ts`: the anchor model (below).
- `report.ts`: the `ChangeReport` with progressive disclosure (verdict, summary, evidence, raw). A `Claim` without evidence can't be shown.
- `stack.ts`: a **stack** is a tree of ordinary PRs linked by branch (a PR targets, or used to target, the head branch of the PR below). Each bottom-to-tip path is one Change. `stack/build.ts` builds it purely from PR metadata plus git facts it asks the engine for. A `PrPart` is one PR's own diff on the path, with how it compares with GitHub's.
- `intent.ts`, `findings.ts`, `diagram.ts`, `context.ts`: the intent ledger, three-lens findings, the data-model diagram and context sources.
- `chat.ts`, `api.ts`: request and response shapes shared by the server and the web app.

`packages/core/src/diff/parse.ts` parses git's diff output (checked against a golden file of real git output), and `change/build.ts` turns it into files and hunks, sorted by path, with hunk ids from their content. `change/canonical.ts` is the view the shape-invariance tests compare.

`packages/core/src/stack/` holds the pure stack helpers, which the browser imports as `@strata/core/stack`: the builder, `summary.ts` (the slim view the stack list and the map use) and `map.ts` (the stack map's layout, one row per PR with lanes for forks, and the same map as Mermaid).

### engine

`packages/engine/src/api.ts` is the contract the CLI and the server code against: `discoverStacks`, `resolveChange`, `analyzeChange`, `readFile`, `resolveAnchors` and `chat`. Stack discovery and stack Changes work, with each PR's diff and the whole-stack diff; the rest throw `NotImplementedError`.

- `github/` reads the PR index (90 days of PRs with retarget and force-push events) over GraphQL and caches it in the data folder.
- `git/` runs git without the user's config, attributes, ignore files or credential helpers, and keeps Strata's own bare clone of each repo, borrowing objects from a local checkout once (`STRATA_CHECKOUTS`, or the CLI's `--repo-path`).
- `git/diff.ts` diffs with fixed settings, replays a PR's changes onto another commit with `merge-tree` (no refs, index or working tree; git 2.38 or later), and writes commits with a fixed author and date.
- `stack/` answers the stack builder's git questions and turns a stack path into a Change. `stack/parts.ts` writes Strata's own chain of commits, one per PR from where the stack left the trunk: a PR's head as it is when it sits on the stack so far, or its changes replayed on, as a restack would, when its link is broken. Each PR's diff runs from the commit below to its own, and the whole-stack diff from the start to the last. A replay conflict stops the chain there and raises `replay-conflict`.

### server

- `src/config.ts` validates the environment once at startup and reports every problem together.
- `src/auth/` handles the GitHub OAuth flow, the allowlist, sessions (only a hash of the token is stored) and encryption of the GitHub token at rest.
- `src/db/` holds the Drizzle schema (users, sessions, Changes, runs and reports) and runs migrations from `drizzle/` on startup.
- `src/routes/api.ts` declares every milestone-1 route. `/api/me`, `GET /api/repos/:owner/:name/stacks` and the Changes routes (`routes/changes.ts`) work; sources, files and threads answer 501.
- `src/runs.ts` runs analyses one at a time in-process; `src/engines.ts` gives each user an engine with their own GitHub token.
- `src/app.ts` adds security headers, CSRF origin checks, `/healthz`, and serves the web build with an SPA fallback.
- `src/dev/fixture-github.ts` is a stand-in GitHub (the engine's demo repo behind a GraphQL endpoint) for driving the app with no token. Outside production, `DEV_GITHUB_GRAPHQL_URL` and `DEV_GIT_REMOTE` point the server at it; the verify skill's `up --github fixture` does that.

### web

`App.tsx` either renders a report embedded in the page (the CLI's output, see `lib/static-report.ts`) or signs in against the server. Routes:

- `/`: "Review a stack" (a PR URL, `owner/repo#N` or `owner/repo:branch`, read back before it's sent), "Browse a repo's stacks", and the user's Changes.
- `/repos/:owner/:name`: the repo's stacks, each with its map, a path picker for forks and a Review button.
- `/changes/:id`: the workspace. The left rail is the stack map (`components/StackMap.tsx`, drawn from core's layout: HTML rows, SVG edges); choosing a PR scopes the panes to it (`?pr=N`, "How it arrived"), and "Whole stack" scopes back. The centre shows the path's counts, its path picker, stack issues with their commit evidence, the report's notes and the whole-stack diff (`components/Diff.tsx`: files by directory, then each file's hunks). A PR's scope shows that PR's own diff, and a banner when GitHub's diff of it differs. It polls while a run is going. Chat returns with highlight-to-chat.

## Highlight and chat

The workspace shows all of a Change's context together and lets the reviewer highlight anything (a paragraph of the spec, a line in a hunk, an entity in the diagram) and ask the agent about it. The scaffold prepares for this in three places:

1. **Anchors** (`core/model/anchors.ts`). Everything selectable is an `Anchor`: a `SourceRef` saying what it points at, plus, for text, an exact quote with a little context before and after and character offsets as a hint. This follows W3C Web Annotations, so a highlight can be found again after the text is re-rendered or edited. Evidence links on claims use the same type.
2. **Line-based surfaces.** Every text surface is a list of lines and its canonical text is the lines joined with `\n`. The UI renders one element per line, so turning a browser selection into an anchor is exact.
3. **Chat routes and stream events.** A chat message carries the anchors it's about; the server resolves them to text (`Engine.resolveAnchors`) and streams the answer back as `ChatStreamEvent`s.

## Shape invariance

The benchmark from SPEC.md runs in `packages/engine/src/shape-invariance.test.ts`. One maverick-like feature (`engine/src/testing/feature-shapes.ts`) is built as one PR, as four chained PRs, with the bottom PR squash-merged while main moves on, with the second PR then rebased, and as a fork. The first four must give the same whole-stack patch-id, files, hunks and canonical report. Layer classification is still `it.todo` in `packages/core/src/layers.test.ts`.

PR descriptions are shown as context but never feed the intent ledger, because they depend on how the work was split.

## Milestone 1: the stack view

Narrowed to PR stacks (plan: "Strata milestone 1: the stack view"). In order:

1. Find the stack around a PR or branch, merged and retargeted PRs included. Done: core's builder, the engine's GitHub index and git cache, `strata stacks`.
2. Store one Change per path and run it on the server. Done.
3. The stack map, the stack list and the path picker in the web app, from PR metadata only. Done.
4. Each PR's own diff and the whole-stack diff, parsed into files and hunks, with a banner when GitHub's diff of a PR differs. Done, in the web app and `strata analyze`.
5. Layers: path rules, repo rules, `.gitattributes`, mechanical changes, then the LLM for the rest.
6. Which PR introduced or revised each hunk, and the layer by PR matrix.
7. The Guide and summaries, from the whole-stack diff only.
8. The CLI's static page, and the shape-invariance check on a real stack against the same code as a plain range.

The intent ledger, findings, the verdict and the data-model diagram come after milestone 1.

## Open questions

- Milestone 1 is proved on a Python service with Beanie models, so the data-model reader in milestone 2 needs a Python parser (tree-sitter is the likely choice).
- How Linear tickets and Notion pages get in: pasted text first, or their APIs from the start.

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
- `stack.ts`: a **stack** is a tree of ordinary PRs linked by branch (a PR targets, or used to target, the head branch of the PR below). Each bottom-to-tip path is one Change. `stack/build.ts` builds it purely from PR metadata plus git facts it asks the engine for.
- `intent.ts`, `findings.ts`, `diagram.ts`, `context.ts`: the intent ledger, three-lens findings, the data-model diagram and context sources.
- `chat.ts`, `api.ts`: request and response shapes shared by the server and the web app.

### engine

`packages/engine/src/api.ts` is the contract the CLI and the server code against: `discoverStacks`, `resolveChange`, `analyzeChange`, `readFile`, `resolveAnchors` and `chat`. Stack discovery and stack Changes work (no diffs yet); the rest throw `NotImplementedError`.

- `github/` reads the PR index (90 days of PRs with retarget and force-push events) over GraphQL and caches it in the data folder.
- `git/` runs git without the user's config, attributes, ignore files or credential helpers, and keeps Strata's own bare clone of each repo, borrowing objects from a local checkout once (`STRATA_CHECKOUTS`, or the CLI's `--repo-path`).
- `stack/` answers the stack builder's git questions and turns a stack path into a Change.

### server

- `src/config.ts` validates the environment once at startup and reports every problem together.
- `src/auth/` handles the GitHub OAuth flow, the allowlist, sessions (only a hash of the token is stored) and encryption of the GitHub token at rest.
- `src/db/` holds the Drizzle schema (users, sessions, Changes, runs and reports) and runs migrations from `drizzle/` on startup.
- `src/routes/api.ts` declares every milestone-1 route. `/api/me`, `GET /api/repos/:owner/:name/stacks` and the Changes routes (`routes/changes.ts`) work; sources, files and threads answer 501.
- `src/runs.ts` runs analyses one at a time in-process; `src/engines.ts` gives each user an engine with their own GitHub token.
- `src/app.ts` adds security headers, CSRF origin checks, `/healthz`, and serves the web build with an SPA fallback.

### web

`App.tsx` either renders a report embedded in the page (the CLI's output, see `lib/static-report.ts`) or signs in against the server. The workspace page is laid out as navigator, panes and chat, with placeholders for now.

## Highlight and chat

The workspace shows all of a Change's context together and lets the reviewer highlight anything (a paragraph of the spec, a line in a hunk, an entity in the diagram) and ask the agent about it. The scaffold prepares for this in three places:

1. **Anchors** (`core/model/anchors.ts`). Everything selectable is an `Anchor`: a `SourceRef` saying what it points at, plus, for text, an exact quote with a little context before and after and character offsets as a hint. This follows W3C Web Annotations, so a highlight can be found again after the text is re-rendered or edited. Evidence links on claims use the same type.
2. **Line-based surfaces.** Every text surface is a list of lines and its canonical text is the lines joined with `\n`. The UI renders one element per line, so turning a browser selection into an anchor is exact.
3. **Chat routes and stream events.** A chat message carries the anchors it's about; the server resolves them to text (`Engine.resolveAnchors`) and streams the answer back as `ChatStreamEvent`s.

## Shape invariance

The benchmark from SPEC.md is wired in from the start as `it.todo` tests in `packages/engine/src/shape-invariance.test.ts`, with the fixture plan written next to them. Layer classification has the same treatment in `packages/core/src/layers.test.ts`. Milestone 1 turns both into real tests.

PR descriptions are shown as context but never feed the intent ledger, because they depend on how the work was split.

## Milestone 1 (not built yet)

In rough order:

1. Resolve a PR, stack or commit range to a local clone and the net diff.
2. Parse the diff into files and hunks; classify hunks into layers (path rules first, then the LLM for the rest); flag mechanical changes.
3. Read schemas and migrations at base and head and diff them into the data-model diagram.
4. Build the intent ledger from linked sources and run the three-lens cross-check.
5. Assemble the report and render it in the web app and as the CLI's single page.
6. Make the shape-invariance tests pass on one real feature split two ways.

## Open questions

- Which repo and feature to prove milestone 1 on. If it's a Python service with Pydantic or Beanie models, the data-model reader needs a Python parser (tree-sitter is the likely choice).
- How Linear tickets and Notion pages get in: pasted text first, or their APIs from the start.

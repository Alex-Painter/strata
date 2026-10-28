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
- `layers.ts`: the semantic layers (data model, API, logic, UI, tests, config, docs, other), their order, and which ones need mandatory inspection; the rules that flag a single file for inspection in any layer, and the flag on `FileChange.inspect`.
- `anchors.ts`: the anchor model (below).
- `report.ts`: the `ChangeReport` with progressive disclosure (verdict, summary, evidence, raw). A `Claim` without evidence can't be shown.
- `stack.ts`: a **stack** is a tree of ordinary PRs linked by branch (a PR targets, or used to target, the head branch of the PR below). Each bottom-to-tip path is one Change. `stack/build.ts` builds it purely from PR metadata plus git facts it asks the engine for. A `PrPart` is one PR's own diff on the path, with how it compares with GitHub's.
- `intent.ts`, `findings.ts`, `diagram.ts`, `context.ts`: the intent ledger, three-lens findings, the data-model diagram and context sources.
- `chat.ts`, `api.ts`: request and response shapes shared by the server and the web app.

`packages/core/src/diff/parse.ts` parses git's diff output (checked against a golden file of real git output), and `change/build.ts` turns it into files and hunks, sorted by path, with hunk ids from their content. `change/canonical.ts` is the view the shape-invariance tests compare. `change/guide.ts` makes the Guide's starting groups from the whole-stack diff (by layer, then mechanical kind, then directory, with ids from what they hold) and applies Claude's plan for them: merged, ordered and labelled, with every file and hunk in exactly one section and the groups it left out kept as they were.

`packages/core/src/layers/` sorts files into layers and finds mechanical changes, from paths, diff lines and the repo's settings only. In order: the repo's own rules, `linguist-documentation` in its root `.gitattributes`, Strata's default path rules (`rules.ts`), Claude's layer for files no rule matched (when the engine was given one), then a low-confidence guess by extension. `mechanical.ts` folds lockfiles, snapshots, binaries, generated and vendored files, unchanged renames and whitespace-only hunks, each with its reason. `inspect.ts` flags files that must be right first time wherever they land: two built-in rules, access and permissions and deletion and retention, look for words in the path's folder and file names (or a rename's old path), split at punctuation, case changes and digits and ignoring case, so `useAuth.ts` has the word "auth" and `author.py` doesn't. A word can be whole (`login`), a start (`permission*`), anywhere in a longer word (`*password*`, for `resetpassword.py`), words in a row (`sign in`), any of those in the file's name only (`file:role`, and `file:*archiv*`, since an `archive/` folder holds old code) or a whole name (`name:policy`), and a rule's `except` words never count (`author` against `auth*`). A few globs cover what words can't (`*.rego`, `*.pem`). Each flag's reason names the word and the name it was found in, the file's first. Every matching rule gives a flag, after the layer is final, so a file Claude puts in Tests or Docs gets none, and nor does a mechanical file or a translation catalog (`locales/`, `*.po`). Repos can't add their own inspect rules yet.

`packages/core/src/stack/` holds the pure stack helpers, which the browser imports as `@strata/core/stack`: the builder, `summary.ts` (the slim view the stack list and the map use) and `map.ts` (the stack map's layout, one row per PR with lanes for forks, and the same map as Mermaid). `matrix.ts` builds the layer by PR matrix (a row per layer, a column per PR, and Net from the whole-stack diff alone), with one evidence anchor per hunk in each cell, and the per-PR layer bars, which the stack map can draw.

### engine

`packages/engine/src/api.ts` is the contract the CLI and the server code against: `discoverStacks`, `findAssigned`, `resolveChange`, `analyzeChange`, `readFile`, `resolveAnchors` and `chat`. Stack discovery, stack Changes and commit ranges on GitHub repos work; ranges in a local checkout, `readFile`, `resolveAnchors` and `chat` throw `NotImplementedError`.

- `github/` reads the PR index (90 days of PRs with retarget and force-push events) over GraphQL and caches it in the data folder. `github/assigned.ts` searches a repo for the open PRs assigned to the token's user or asking for their review, directly or through a team, leaving out their own.
- `git/` runs git without the user's config, attributes, ignore files or credential helpers, and keeps Strata's own bare clone of each repo, borrowing objects from a local checkout once (`STRATA_CHECKOUTS`, or the CLI's `--repo-path`).
- `git/diff.ts` diffs with fixed settings, replays a PR's changes onto another commit with `merge-tree` (no refs, index or working tree; git 2.38 or later), and writes commits with a fixed author and date.
- `stack/` answers the stack builder's git questions and turns a stack path into a Change. `stack/parts.ts` writes Strata's own chain of commits, one per PR from where the stack left the trunk: a PR's head as it is when it sits on the stack so far, or its changes replayed on, as a restack would, when its link is broken. Each PR's diff runs from the commit below to its own, and the whole-stack diff from the start to the last. A replay conflict stops the chain there and raises `replay-conflict`. Every diff is sorted into layers by one classifier built from the whole stack: the repo's rules, its `.gitattributes` at the top of the stack, and Claude's answers about the whole-stack diff, which each PR's diff reuses by path.
- `stack/provenance.ts` runs git blame over Strata's chain: forward from the top of the stack to name the PR behind each line the whole stack adds, and `--reverse` to name the PR that removed each trunk line and the later PR that changed each line a PR added. It's stored on each part (`PrPart.provenance`), so it stays out of the whole-stack view and its canonical form. Mechanical and binary files aren't traced.
- `whole.ts` is the part of a report that mustn't depend on the split: it diffs the whole Change, sorts it into layers (with Claude's answers when allowed), and writes the summaries and the notes about them. A stack's whole diff runs from where it left the trunk to Strata's last commit on its chain; `range.ts` runs a range from the merge base of its base and head, with no stack or parts, so the same code gives the same canonical report either way.
- `git/checkout.ts` reads a checkout's GitHub repo and current branch, for `strata analyze` with no input.
- `settings.ts` reads a repo's own settings from Strata's data folder, never from the repo: `settings/<owner>/<name>.json`, with `layerRules` and `sendCodeToAnthropic`.
- `llm.ts` makes the Anthropic client (or takes a fake, or a stand-in's base URL) and asks Claude for JSON against a schema, caching each answer by a hash of the exact request.
- `summaries/summaries.ts` asks Claude for the summary and the Guide's sections from the whole-stack diff (paths, layers, Strata's groups and hunk text, with long hunks cut and the rest past a budget listed by header), and for a summary of each PR from its own diff. Claude cites hunks and groups by labels (`h1`, `g1`); a sentence citing a label it wasn't given, or none, is dropped. The whole-stack request never names PRs, titles, branches or commits, so it's the same for every split. It runs only for repos that turn on `sendCodeToAnthropic`; otherwise the Guide is Strata's groups and a note says why there's no summary. Answers are cached under `llm-cache/summaries/`.
- `layers/judge.ts` asks Claude for the layer of whole-stack files no rule matched, only for repos whose settings turn on `sendCodeToAnthropic` and only with an Anthropic key. It sends paths, the first changed lines of each file and the placed files' layers, asks for JSON against a schema, and caches each answer under `llm-cache/layers/` by a hash of the exact request, so the same diff gets the same answer on every run. A failed request leaves those files' guesses in place and says so in the report's notes.

### server

- `src/config.ts` validates the environment once at startup and reports every problem together.
- `src/auth/` handles the GitHub OAuth flow, the allowlist, sessions (only a hash of the token is stored) and encryption of the GitHub token at rest.
- `src/db/` holds the Drizzle schema (users, sessions, Changes, assignments, runs and reports) and runs migrations from `drizzle/` on startup.
- `src/routes/api.ts` declares every milestone-1 route. `/api/me`, the assignment search, `GET /api/repos/:owner/:name/stacks` and the Changes routes (`routes/changes.ts`) work; sources, files and threads answer 501.
- `src/assigned.ts` is the assignment search. For each repo in `STRATA_ASSIGNED_REPOS` (GlyphicAI/maverick-backend by default; empty turns it off), it asks the engine for the open PRs assigned to the user or asking for their review. It makes each one's Change the way a typed-in PR does (`src/change-store.ts`), so several of your PRs on one path share a Change. It queues a run when the Change is new or one of its heads has moved since the last run it queued (`changes.queued_heads`). It records why each PR is yours in `assignments`, and marks a row inactive once GitHub stops listing it. It runs at startup, every 10 minutes and on `POST /api/assigned/search`; `GET /api/assigned` says where it stands.
- `src/runs.ts` runs analyses one at a time in-process; `src/engines.ts` gives each user an engine with their own GitHub token.
- `src/jobs.ts` runs the slow requests, listing a repo's stacks and finding a new Change's stack, as jobs keyed by user and input. A request waits 1.5 s, then answers `202 {"pending":true,"progress":...}` with the latest step; the client asks again with the same request until it gets the result. A job carries on if its client goes away, and its result waits 5 minutes for a client to collect it, so one that went away gets it when it asks again. A new Change is only made for a client that's still there. The server's engines set `logProgress`, so the clone and fetch steps a job follows stay in the server log too.
- `src/app.ts` adds security headers, CSRF origin checks, `/healthz`, and serves the web build with an SPA fallback.
- `src/dev/fixture-github.ts` is a stand-in GitHub (the engine's demo repo behind a GraphQL endpoint) for driving the app with no token. Outside production, `DEV_GITHUB_GRAPHQL_URL` and `DEV_GIT_REMOTE` point the server at it; the verify skill's `up --github fixture` does that. It also serves a stand-in Claude (`src/dev/fixture-claude.ts`) that answers from Strata's own prompts; `DEV_ANTHROPIC_BASE_URL` points the server's Anthropic client at it, and `up --claude fixture` wires it up.

### web

`App.tsx` either renders a report embedded in the page (the CLI's output, see `lib/static-report.ts`) or signs in against the server.

The look follows the Cross-Section design: Linear-like, dark first with a light theme, neutral greys and one accent (indigo, for selection, focus, primary buttons, switches and PR seams). Colour carries meaning only: added and removed lines, and (once there's a diagram) added, changed and removed entities. Labels are sentence case, and status is a word, never a coloured dot. The tokens live in `styles.css`, and Tailwind's utilities read them (`bg-surface`, `text-muted`, `border-line`). The theme follows the system unless the reader picks one, which this browser keeps (`lib/theme.ts`). Inter and JetBrains Mono are bundled, Latin only, so the CLI's single-file page needs no network.

Every page sits in `components/AppShell.tsx`: a sidebar on the chrome (the home link, the page's navigation, the reader's login, the theme switch and Sign out) and one inset card with a 44 px top bar holding a breadcrumb. Below 960 px the sidebar is a drawer behind the menu button. Routes:

- `/`: "Review a stack" (a PR URL, `owner/repo#N` or `owner/repo:branch`, read back before it's sent), "Browse a repo's stacks", and the user's Changes. The sidebar lists the repos they've reviewed.
- `/repos/:owner/:name`: the repo's stacks, each with its map (`components/StackMap.tsx`, drawn from core's layout: HTML rows, SVG edges), a path picker for forks and a Review button.
- `/changes/:id`: the workspace (`workspace/`). Where the reader is lives in the URL: `?pr=N` scopes to one PR of the path, `?layer=api` shows a layer. A CLI page keeps the same in memory.

The workspace (`workspace/Workspace.tsx`) has three parts:

- **Sidebar.** "Whole stack" (or "Overview" for a range), the Change's layers in review order as 28 px rows with line icons and their file count in the current scope (layers the scope doesn't touch are dimmed), and a collapsible "Pull requests" list of the path, bottom first, number and title. Choosing a PR scopes to it; choosing it again scopes back.
- **Canvas.** The overview (`workspace/Overview.tsx`) or one layer (`workspace/LayerView.tsx`). The whole stack's overview has its counts, the path picker, stack issues with their commit evidence, Claude's summary, the Guide (`components/Guide.tsx`) and the layers to go to, with layers to inspect flagged; a range's has where it branched instead of PRs; a PR's has "How it arrived", the banner when GitHub's diff of it differs, what it changes and its layers. A layer shows what the Guide says about it (or, in a PR's scope, the PR's sentences about it), then its files, each with its hunks in Linear's style (`components/Diff.tsx`): files say why they're in their layer, each file an inspect rule matched is tagged with the word and the name it was found in, big files start closed, and mechanical files and hunks start folded with their reason. The top of a layer is a slot for its diagram; nothing fills it until the engine extracts one (core's `model/diagram.ts`). Above the canvas, the view bar names the view, its files and lines, and a chip for each display option that's on, with Display (V) at the right.
- **Side panel** (`workspace/Panel.tsx`, `\` hides it). With nothing selected: the status, the stack, the path, where it left the trunk, the scope, the diff and when it was analysed, then the stack's notes (what depends on how the work was split) and the report's. A selected file shows its layer and why, its lines, its hunks, and the PRs its lines came from; a hunk shows the same, plus the sentences that cite it; a sentence shows how it was written and its evidence, each hunk opening in its layer. Every sentence's button (`components/Claims.tsx`) selects it; a sentence with none of its hunks in the diff isn't shown. The Ask tab is there but disabled until chat exists.

The status pill in the top bar is the verdict when a report has one, and otherwise says there's no verdict yet, or what the run is doing. Secondary options sit behind the Display popover (`workspace/Overlays.tsx`) and stay in this browser: the layer by PR matrix (`components/LayerMatrix.tsx`, a row per layer, a column per PR and Net, shaded in greys; a cell opens to its files, each opening in that PR's scope), PR seams (whole-stack hunks marked "from #N", a PR's hunks "revised in #N", from `lib/provenance.ts`), and folding mechanical files. The keyboard: J and K move through what can be selected on the canvas, ↑ and ↓ (or the bracket keys) move between layers, O goes to the overview, V, S and M open Display and toggle seams and the matrix, `?` shows the shortcuts, ⌘K jumps to a layer, PR or file, and Esc backs out one step (popover, selection, then the PR scope). Single keys never fire while typing.

It polls while a run is going. The stack list and new Changes ask again each second while the server answers 202 (the stack list and the "Review a stack" box show its latest step); they stop on an error, and a request that's replaced, edited away or left behind stops asking (`lib/latest-request.ts`). Chat returns with highlight-to-chat.

### cli

`src/main.ts` parses the command (`args.ts`), runs the engine (`engine.ts`, which also reads the server's `DEV_` settings for stand-ins), prints the report (`report.ts`, with each flagged file's reason, every flagged file even past the 40-file cut, and a rename as `R old → new`) and writes the page and JSON (`html.ts`): the web app's `dist-static/index.html` with the report embedded, in `reports/<owner>/<name>/` in the data folder by default. `html.ts` refuses any path inside a git checkout, found by the nearest `.git` above it with symlinks resolved. `scripts/stack-vs-range.ts` is the shape-invariance check on a real stack, comparing canonical reports and printing where they differ (`compare.ts`, places only, never code), or that it could compare only the PRs in the whole-stack diff.

## Highlight and chat

The workspace shows all of a Change's context together and lets the reviewer highlight anything (a paragraph of the spec, a line in a hunk, an entity in the diagram) and ask the agent about it. The scaffold prepares for this in three places:

1. **Anchors** (`core/model/anchors.ts`). Everything selectable is an `Anchor`: a `SourceRef` saying what it points at, plus, for text, an exact quote with a little context before and after and character offsets as a hint. This follows W3C Web Annotations, so a highlight can be found again after the text is re-rendered or edited. Evidence links on claims use the same type.
2. **Line-based surfaces.** Every text surface is a list of lines and its canonical text is the lines joined with `\n`. The UI renders one element per line, so turning a browser selection into an anchor is exact.
3. **Chat routes and stream events.** A chat message carries the anchors it's about; the server resolves them to text (`Engine.resolveAnchors`) and streams the answer back as `ChatStreamEvent`s.

## Shape invariance

The benchmark from SPEC.md runs in `packages/engine/src/shape-invariance.test.ts`. One maverick-like feature (`engine/src/testing/feature-shapes.ts`) is built as one PR, as four chained PRs, with the bottom PR squash-merged while main moves on, with the second PR then rebased, as a fork, and merged all at once after main moves on (each PR lands on main as one new commit while GitHub keeps the branch below as its base). Every shape but the fork must give the same whole-stack patch-id, files, hunks, layers, inspect flags and canonical report, and ask Claude (fakes that record their questions) the same question about the files no rule matched, and the same summary question, byte for byte, with no PR numbers, titles, branches or commits in it. Their summaries and Guides must match too, and so must the stack's code given as a plain range, with the same questions to Claude. `packages/core/src/layers.test.ts` holds the layer rules and the inspect rules as tables of paths, near misses (`BlogIndex.tsx`, Ansible's `roles/`, an `archive/` folder of old scripts) included.

PR descriptions are shown as context but never feed the intent ledger, because they depend on how the work was split.

## Milestone 1: the stack view

Narrowed to PR stacks (plan: "Strata milestone 1: the stack view"). In order:

1. Find the stack around a PR or branch, merged and retargeted PRs included. Done: core's builder, the engine's GitHub index and git cache, `strata stacks`.
2. Store one Change per path and run it on the server. Done.
3. The stack map, the stack list and the path picker in the web app, from PR metadata only. Done.
4. Each PR's own diff and the whole-stack diff, parsed into files and hunks, with a banner when GitHub's diff of a PR differs. Done, in the web app and `strata analyze`.
5. Layers: path rules, repo rules, `.gitattributes`, mechanical changes, then Claude for the rest when a repo allows it, and per-file inspect flags for access and deletion. Done, in the web app and `strata analyze`. The maverick paths in the rule table still need checking against the real repo.
6. Which PR introduced or revised each hunk, and the layer by PR matrix. Done, with hunk chips and layer bars, in the web app and `strata analyze`.
7. The Guide and summaries, from the whole-stack diff only, and a summary per PR. Done, in the web app and `strata analyze`. Real answers still need a key and a real stack.
8. The CLI's static page, and the shape-invariance check on a real stack against the same code as a plain range. Done: `strata analyze` writes the page and JSON to the data folder, ranges on GitHub repos work in the engine, the CLI and the page, and `apps/cli/scripts/stack-vs-range.ts` makes the check. It still needs running on a real stack.

The intent ledger, findings, the verdict and the data-model diagram come after milestone 1.

## Open questions

- Milestone 1 is proved on a Python service with Beanie models, so the data-model reader in milestone 2 needs a Python parser (tree-sitter is the likely choice).
- How Linear tickets and Notion pages get in: pasted text first, or their APIs from the start.

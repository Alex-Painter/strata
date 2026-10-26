# Stacks

A stack is a group of PRs whose branches feed into each other. The reviewer gives Strata one PR or branch and gets the whole stack around it as a Change, or browses every stack in a repo and opens one. The workspace shows the stack map as its left rail: tips on top, the trunk at the bottom, merged PRs included. Choosing a PR on the map scopes the page to that PR ("How it arrived"). A stack that forks has one path, and one Change, per tip, with a path picker to move between them. Each scope ends with its diff: the whole-stack diff, or the PR's own, with a banner when GitHub's diff of the PR differs, sorted into layers. The whole stack shows Claude's summary, then the Guide (the order to read it in), then the layer by PR matrix, and a PR shows what it changes. Without Claude, the Guide is Strata's own groups and the page says why there's no summary.

## Sub-features

- `new-change`: the "Review a stack" box on the home page reads back what it will look up, then opens the Change.
- `stack-list`: `/repos/<owner>/<name>` lists the repo's stacks, newest activity first, each with its map and a Review button.
- `stack-map`: the rail in the workspace. Every PR links to GitHub, merged PRs link to the commit they landed as, and a PR that needs a restack has a dashed edge and says so.
- `pr-scope`: choosing a PR on the map shows its branches, how it sits on its parent with commit evidence, where its own changes start, and its issues. The URL gets `?pr=<n>`.
- `path-picker`: a fork offers one choice per path. Picking another path opens that path's Change.
- `diffs`: the Files section lists the files by directory, each linking to its diff, and big files start closed. The whole stack shows the whole-stack diff; a PR shows its own, says when Strata replayed it onto the stack below, and shows a `GitHub's diff` banner when GitHub's diff differs.
- `summaries`: three to six sentences about the whole stack and one to three per PR, each with a button that opens the hunks it rests on in place.
- `guide`: the whole stack's sections in reading order, each opening to its files; Claude's when the repo allows it, Strata's groups otherwise.
- `mermaid`: "Copy as Mermaid" puts the map on the clipboard as a flowchart.
- `changes-api`: `GET /api/repos/:owner/:name/stacks`, `POST /api/changes`, `GET /api/changes`, `GET /api/changes/:id` and `POST /api/changes/:id/runs`. One Change per path: asking again for any PR on a path returns the same Change.

## How to get to it (user POV)

- On the home page, paste a PR URL, `owner/repo#123` or `owner/repo:branch` into "Review a stack" and choose Review.
- On the home page, type `owner/repo` under "Browse a repo's stacks" and choose Show stacks, or open `/repos/<owner>/<name>`.
- In a Change, choose a PR on the map, or "Whole stack" above it.

## Driving it with strata-verify

Preconditions:

- Stacks need GitHub data, and a plain `up` has none. Use one of:
  - `strata-verify up --github fixture` (no token, no network). A stand-in GitHub serves `acme/app`: a three-PR stack #9 → #10 → #11 where #10 is behind #9 and #11 is a draft; a fork #5 → {#6, #7}; a chain #1 → #2 → #3 whose bottom PR was squash-merged; a lone #4; and a fork-repo PR #8. The rest of this recipe uses it.
  - `strata-verify up --github gh --checkouts GlyphicAI/maverick-backend=$HOME/workspace/maverick-backend` on the developer's Mac, for a real repo. It passes the token from `gh auth token` to the server's environment only. Compare what you see with the hand-written trees of the proving stacks.
- Run `doctor` and require exit 0. With the fixture it also checks the stand-in GitHub is alive.

API (`$B` is the RUN_ID):

- **List.** `strata-verify http $B stacks/list GET /api/repos/acme/app/stacks` returns 200 with three stacks, roots 9, 5 and 1 in that order. The #5 stack has `paths` `[[5,6],[5,7]]` and `defaultPath` `[5,7]`. #10 has `link` `"behind"`, a `needs-restack` issue and `linkEvidence` naming commits. #1 is `merged` with a `mergeCommitOid`.
- **Unknown repo.** `strata-verify http $B stacks/unknown GET /api/repos/acme/other/stacks` returns `502 {"error":"GitHub has no repo acme/other, or the token can't see it."}`.
- **Create.** `strata-verify http $B stacks/create POST /api/changes -H 'Content-Type: application/json' -d '{"input":"https://github.com/acme/app/pull/10"}'` returns 201 with `change.title` `"Cache forecasts per account"`.
- **Same path, same Change.** Repeat with `{"input":"acme/app#11"}`: 200 with the same `change.id`.
- **A fork's other path.** `{"input":"acme/app#5","leaf":6}` and `{"input":"acme/app#5"}` return two different ids.
- **Run result.** `strata-verify http $B stacks/detail GET /api/changes/<id>` shows `run.status` `"done"` (it goes from queued to done in about a second), `report.schemaVersion` `6`, `report.stack.selectedPath` `[9,10,11]`, `report.change.files` with `app/forecast_cache.py`, `app/jobs/warm_cache.py`, `migrations/0042_forecast_cache.sql`, `tests/test_warm_cache.py`, `uv.lock` and `web/admin/CacheStats.tsx`, `report.change.layers[].layer` `["data-model","logic","ui","tests","config"]`, `uv.lock`'s `mechanical.kind` `"lockfile"`, and `report.parts[].how` `["direct","replayed","replayed"]`. `POST /api/changes/<id>/runs` with `-d '{}'` returns 202 and a new run.
- **Bad input.** `{"input":"not a pr"}` returns 400 `Can't read "not a pr"...`; `{"input":"acme/app#1,3"}` returns 400 `...isn't a chain of branch links...`; `{"input":"acme/app@main...b4"}` returns 501.

Web (`URL` is the run's URL):

- **New Change.** `navigate` to `URL/`. Fill `textbox "PR or branch"` with `https://github.com/acme/app/pull/10`. The hint under it reads `The stack around #10 in acme/app.` Choose `button "Review"`. The URL becomes `URL/changes/chg_...`. `list "Stack map"` has the rows `#11`, `#10`, `#9`, then `main` with `left at <sha>`. The `#10` row reads `Behind #9: needs a restack`. The centre pane reads `3 PRs: 3 open · on main, left at <sha>`, shows the restack issue with its evidence links, the notes `Strata guessed the layers of 2 files. To place them, add layer rules or turn on sendCodeToAnthropic in settings/acme/app.json in Strata's data folder.` and `There's no summary, and the Guide shows Strata's own groups. To have Claude write them, turn on sendCodeToAnthropic in settings/acme/app.json in Strata's data folder.`, and `heading "Files"` with `6 files · +27 −0` (hover: `All lines: +32 −0`, since the lockfile doesn't count). `navigation "File list"` groups them by layer, then directory: `Data model` `Inspect` (`migrations`), `Logic` (`app`, `app/jobs`), `UI` (`web/admin`), `Tests` (`tests`), `Config & infra` `Inspect` (`/`). Each layer has a `region` named after it with its files' diffs; each open file says why it's in its layer, such as `Data model: Database migration or SQL: matches **/migrations/**`, and the fallback ones end `, a guess`. `uv.lock` starts closed with `Dependency lockfile`. `app/forecast_cache.py` has `TTL = timedelta(hours=6)`, #9's head now.
- **Strata's Guide.** Under the notes, with no `heading "Summary"`, `heading "Guide"` reads `Strata's groups of the whole stack: by layer, then mechanical kind, then directory.` and lists `1 Data model: migrations/ 1 file · +5 −0`, `2 Logic: app/`, `3 Logic: app/jobs/`, `4 UI: web/admin/`, `5 Tests: tests/` and `6 Config & infra: lockfiles 1 file · mechanical`. Choosing a section's button expands it (`aria-expanded` true) to `list "Files in <title>"`, whose links scroll to the file's diff.
- **Matrix.** Below the Guide, `table "Layers by PR"` has the columns `#9`, `#10`, `#11` and `Net`, and the rows Data model `5 · · · 5`, Logic `7 · 6↻2 · 4 · 13`, UI `· · 4 · 4`, Tests `· 5 · · 5`, Config & infra `· 0+5m · · 0+5m`. Choosing `button` `Logic in #11: 4 lines, 1 file` presses it and opens `region "Logic in #11"` with `app/jobs/warm_cache.py` `4 lines · 1 hunk`; choosing that link goes to `?pr=11` and scrolls to the file. In the whole-stack files, `app/jobs/warm_cache.py`'s hunk has the chips `from #10` (title `#10 added 4 lines of this hunk.`) and `from #11`.
- **Layer bars.** Each `list "Stack map"` row has a bar: `img` `12 lines in 2 files` for #9, `11 lines in 3 files, plus 5 mechanical` for #10 and `8 lines in 2 files` for #11, coloured by layer with mechanical lines grey.
- **Layers rail.** The rail's `region "Layers"` lists the same five layers with counts, `Inspect` on Data model and Config & infra. Choosing `link "Config & infra Inspect 1"` scrolls to that region and sets `#layer:config`.
- **Repo rules.** Write `{"layerRules":[{"id":"app","layer":"logic","paths":["app/**"],"reason":"Our backend code"}]}` to `<run dir>/instance/data/settings/acme/app.json`, `POST /api/changes/<id>/runs` with `-d '{}'`, and reload once it's done. `app/jobs/warm_cache.py` now reads `Logic: Our backend code: matches app/**`, and the `Strata guessed` note is gone. Claude's own answers are covered below, with the stand-in Claude.
- **Links.** In the map, each `link "#<n>"` points at `https://github.com/acme/app/pull/<n>`.
- **PR scope.** Choose `button "Show #10 Warm the forecast cache nightly"`. The URL gets `?pr=10` and the pane shows `How it arrived`, `#10 Warm the forecast cache nightly`, `Review required`, `Checks running`, `Branch b10 into b9`, the link `Behind #9: needs a restack.` with commit evidence, `Its changes start after <sha>` and `Stacked on it #11`, then `Strata put this PR's changes on the stack below it, as a restack would.` and `note "Revised later"`: `2 lines this PR added were changed again later, in #11.` Its Files: `app/jobs/warm_cache.py` under `Logic`, with a `revised in #11` chip on its hunk (choosing it goes to `?pr=11`), `tests/test_warm_cache.py` under `Tests`, and `uv.lock` under `Config & infra`, `3 files · +11 −0`. The rail has no `Layers` region in a PR's scope. There's no `GitHub's diff` banner: GitHub diffs #10 from where it left #9 and gets the same files. Choose `button "Whole stack"` to go back.
- **GitHub banner.** Review `acme/app#2` and choose `button "Show #2 Add the forecast service"`. `region "GitHub's diff"` reads `GitHub's diff of #2 is different from this one.`, `#1 landed on main as a new commit, and #2 hasn't been rebased since, so GitHub's diff of #2 repeats #1's changes.`, `Only on GitHub: b1-2.txt`, with two commit links. Its Files list only `b2-3.txt`.
- **Stack list.** `navigate` to `URL/repos/acme/app`. Expect `heading "Stacks in acme/app"` and the articles `Stack from #9`, `Stack from #5` and `Stack from #1`. In `Stack from #1`, the `#1` row reads `Merged` and links `as <sha>` to the commit.
- **Fork.** In `Stack from #5`, the buttons `#5 → #6 Show admins in settings` and `#5 → #7 Email admins` (pressed) pick a path, and `#6` is dimmed until it's on the picked path. Choose `button "Review 2 PRs"`. The workspace shows the same two choices under `This stack forks into 2 paths. Each one is its own Change.`; choosing the other one opens a different `/changes/` id.
- **Mermaid.** `button "Copy as Mermaid"` reads `Copied` for a moment. The clipboard starts `flowchart BT`.

With the stand-in Claude (`strata-verify up --github fixture --claude fixture`, `$C` its RUN_ID): it answers from Strata's own prompts, the same way every time. Review `https://github.com/acme/app/pull/10` as above.

- **Summary.** The notes box is gone: Claude placed the two guessed files (each reads `Logic: The fixture Claude calls every file logic, Claude's call`) and wrote the summary. `heading "Summary"` lists four sentences, `Data model: migrations/ changes migrations/0042_forecast_cache.sql.`, `Logic: app/ changes app/forecast_cache.py.`, `Logic: app/jobs/ changes app/jobs/warm_cache.py.` and `UI: web/admin/ changes web/admin/CacheStats.tsx.`, each followed by `button "1 hunk: <path>:1"`, then `Written by Claude from the whole-stack diff alone.` The stand-in also wrote a fifth sentence citing a hunk that doesn't exist; it must not appear. Choosing a sentence's button sets `aria-expanded` true and shows that hunk under its path (for `app/forecast_cache.py`, `TTL = timedelta(hours=6)`); the path links to the file's diff, and choosing the button again hides it.
- **Claude's Guide.** `heading "Guide"` reads `Claude's reading order for the whole stack: ...` and lists `1 Read first: the logic 2 files · +13 −0` with `Covers app/forecast_cache.py, app/jobs/warm_cache.py.` and `button "2 hunks: ..."`, `2 Then the storage 1 file · +5 −0`, then the groups Claude left out, as Strata grouped them: `3 UI: web/admin/`, `4 Tests: tests/`, `5 Config & infra: lockfiles 1 file · mechanical`.
- **A PR's summary.** Choose `button "Show #10 Warm the forecast cache nightly"`. Under `Strata put this PR's changes on the stack below it`, `heading "What it changes"` lists `Changes app/jobs/warm_cache.py.`, `Changes tests/test_warm_cache.py.` and `Changes uv.lock.`, each opening #10's own hunk, then `Written by Claude from this PR's own diff.`
- **Cache.** `POST /api/changes/<id>/runs` with `-d '{}'` gives the same summary: answers are cached under `<run dir>/instance/data/llm-cache/summaries/`, one file per request (one for the whole stack, one per PR).

Save each `read_page` tree with `strata-verify note $B stacks/<step>.aria.txt`, with the URL you were on.

## Gotchas

- The first request for a repo clones it into the instance's data folder, so `POST /api/changes` and the stack list take longer the first time. On a real repo this can be many seconds; pass `--checkouts` so Strata borrows objects from a local checkout.
- The fixture's timestamps are moved to the last hour at startup, so "updated 1h ago" is expected, and its commit ids change on every `up`. Compare structure, not shas.
- `?pr=<n>` with a PR outside the stack shows the whole stack rather than an error.
- The stand-in Claude's sentences are mechanical on purpose ("Changes <path>."). They test the plumbing: labels, dropping bad citations, the Guide's merge and order, and opening hunks. How good real answers are can only be judged with a real key on a real stack.
- With `--github gh`, the real repo's data stays on the developer's machine. Don't paste work titles or code into evidence you share outside it.

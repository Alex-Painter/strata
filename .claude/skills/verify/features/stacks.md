# Stacks

A stack is a group of PRs whose branches feed into each other. The reviewer gives Strata one PR or branch and gets the whole stack around it as a Change, or browses every stack in a repo and opens one. The workspace shows the stack map as its left rail: tips on top, the trunk at the bottom, merged PRs included. Choosing a PR on the map scopes the page to that PR ("How it arrived"). A stack that forks has one path, and one Change, per tip, with a path picker to move between them. Each scope ends with its diff: the whole-stack diff, or the PR's own, with a banner when GitHub's diff of the PR differs. Layers and summaries aren't computed yet, and the page says so.

## Sub-features

- `new-change`: the "Review a stack" box on the home page reads back what it will look up, then opens the Change.
- `stack-list`: `/repos/<owner>/<name>` lists the repo's stacks, newest activity first, each with its map and a Review button.
- `stack-map`: the rail in the workspace. Every PR links to GitHub, merged PRs link to the commit they landed as, and a PR that needs a restack has a dashed edge and says so.
- `pr-scope`: choosing a PR on the map shows its branches, how it sits on its parent with commit evidence, where its own changes start, and its issues. The URL gets `?pr=<n>`.
- `path-picker`: a fork offers one choice per path. Picking another path opens that path's Change.
- `diffs`: the Files section lists the files by directory, each linking to its diff, and big files start closed. The whole stack shows the whole-stack diff; a PR shows its own, says when Strata replayed it onto the stack below, and shows a `GitHub's diff` banner when GitHub's diff differs.
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
- **Run result.** `strata-verify http $B stacks/detail GET /api/changes/<id>` shows `run.status` `"done"` (it goes from queued to done in about a second), `report.schemaVersion` `3`, `report.stack.selectedPath` `[9,10,11]`, `report.change.files` with `app/forecast_cache.py`, `app/jobs/warm_cache.py` and `web/admin/CacheStats.tsx`, and `report.parts[].how` `["direct","replayed","replayed"]`. `POST /api/changes/<id>/runs` with `-d '{}'` returns 202 and a new run.
- **Bad input.** `{"input":"not a pr"}` returns 400 `Can't read "not a pr"...`; `{"input":"acme/app#1,3"}` returns 400 `...isn't a chain of branch links...`; `{"input":"acme/app@main...b4"}` returns 501.

Web (`URL` is the run's URL):

- **New Change.** `navigate` to `URL/`. Fill `textbox "PR or branch"` with `https://github.com/acme/app/pull/10`. The hint under it reads `The stack around #10 in acme/app.` Choose `button "Review"`. The URL becomes `URL/changes/chg_...`. `list "Stack map"` has the rows `#11`, `#10`, `#9`, then `main` with `left at <sha>`. The `#10` row reads `Behind #9: needs a restack`. The centre pane reads `3 PRs: 3 open · on main, left at <sha>`, shows the restack issue with its evidence links, the note `Layers and summaries aren't computed yet.`, and `heading "Files"` with `3 files · +17 −0`. `navigation "File list"` groups them under `app`, `app/jobs` and `web/admin`, and each file's diff shows its lines; `app/forecast_cache.py` has `TTL = timedelta(hours=6)`, #9's head now.
- **Links.** In the map, each `link "#<n>"` points at `https://github.com/acme/app/pull/<n>`.
- **PR scope.** Choose `button "Show #10 Warm the forecast cache nightly"`. The URL gets `?pr=10` and the pane shows `How it arrived`, `#10 Warm the forecast cache nightly`, `Review required`, `Checks running`, `Branch b10 into b9`, the link `Behind #9: needs a restack.` with commit evidence, `Its changes start after <sha>` and `Stacked on it #11`, then `Strata put this PR's changes on the stack below it, as a restack would.` and its Files: only `app/jobs/warm_cache.py`, `+6 −0`. There's no `GitHub's diff` banner: GitHub diffs #10 from where it left #9 and gets the same file. Choose `button "Whole stack"` to go back.
- **GitHub banner.** Review `acme/app#2` and choose `button "Show #2 Add the forecast service"`. `region "GitHub's diff"` reads `GitHub's diff of #2 is different from this one.`, `#1 landed on main as a new commit, and #2 hasn't been rebased since, so GitHub's diff of #2 repeats #1's changes.`, `Only on GitHub: b1-2.txt`, with two commit links. Its Files list only `b2-3.txt`.
- **Stack list.** `navigate` to `URL/repos/acme/app`. Expect `heading "Stacks in acme/app"` and the articles `Stack from #9`, `Stack from #5` and `Stack from #1`. In `Stack from #1`, the `#1` row reads `Merged` and links `as <sha>` to the commit.
- **Fork.** In `Stack from #5`, the buttons `#5 → #6 Show admins in settings` and `#5 → #7 Email admins` (pressed) pick a path, and `#6` is dimmed until it's on the picked path. Choose `button "Review 2 PRs"`. The workspace shows the same two choices under `This stack forks into 2 paths. Each one is its own Change.`; choosing the other one opens a different `/changes/` id.
- **Mermaid.** `button "Copy as Mermaid"` reads `Copied` for a moment. The clipboard starts `flowchart BT`.

Save each `read_page` tree with `strata-verify note $B stacks/<step>.aria.txt`, with the URL you were on.

## Gotchas

- The first request for a repo clones it into the instance's data folder, so `POST /api/changes` and the stack list take longer the first time. On a real repo this can be many seconds; pass `--checkouts` so Strata borrows objects from a local checkout.
- The fixture's timestamps are moved to the last hour at startup, so "updated 1h ago" is expected, and its commit ids change on every `up`. Compare structure, not shas.
- `?pr=<n>` with a PR outside the stack shows the whole stack rather than an error.
- With `--github gh`, the real repo's data stays on the developer's machine. Don't paste work titles or code into evidence you share outside it.

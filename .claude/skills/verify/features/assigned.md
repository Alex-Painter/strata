# Assigned Changes

Strata searches the repos it's told to (`STRATA_ASSIGNED_REPOS`, GlyphicAI/maverick-backend by default) for open PRs that are assigned to the user or ask for their review, directly or through a team. It leaves out the user's own PRs. Each PR becomes the Change for its whole path, the same Change typing it in would give: a lone PR gives a one-PR Change, and one PR in a stack gives the whole stack. The search runs when the server starts, every 10 minutes after that, and on Refresh. New Changes are analysed straight away and again once a head moves. The home page shows them under "Waiting on you", and the workspace marks your PRs "yours".

## Sub-features

- `waiting` lists the Changes with a PR GitHub still lists for you, saying which PR and why.
- `whole-path` means a PR in the middle of a stack gives the Change for the whole path.
- `refresh` starts a search now and shows its progress.
- `not-waiting` lists Changes with a PR you've reviewed already, or that GitHub no longer lists for you, under "Assigned to you, not waiting". They're analysed too.
- `opened` lists Changes you made yourself (Analyse on a stack nobody asked you about) under "Opened by you".
- `other-stacks` lists the searched repo's open stacks with no Change yet under "Other stacks in <repo>", unanalysed until you choose Analyse on the stack page. A stack page path that already has a Change shows Open instead.
- `yours-marker` tags your PRs in the workspace's Pull requests list, and the workspace still opens on the whole stack.

## How to get to it (user POV)

- Open the home page. "Waiting on you" sits at the top, with a Refresh button.
- Open a Change from that list. In the stack graph at the left of the main pane, your PRs say `yours`.

## Driving it with strata-verify

Preconditions:

- One instance from `strata-verify up --github fixture --assigned acme/app`, passing `doctor`. `$R` is its RUN_ID. The fixture lists `#4` as assigned to `verify-bot`, asks for its review on `#10` through the team `acme/backend`, and has it as a reviewer of `#3`. Without `--assigned`, the search is off and the section is hidden.

- **Search status.** `strata-verify http $R assigned/status GET /api/assigned`. A few seconds after start, expect `200` with `"repos":["acme/app"]`, `"running":false`, a `lastFinishedAt` and `"errors":[]`.
- **Waiting on you.** `navigate` to `URL/`, then `read_page`. Expect `heading "Waiting on you"`, `button "Refresh"`, the text `Searched acme/app`, and two rows: `Cache forecasts per account` with `#10 review requested from acme/backend`, and `Fix a typo` with `#4 assigned`, each with `Analysed` once their runs finish. Save it with `strata-verify note $R assigned/home.aria.txt`.
- **Whole path.** `strata-verify http $R assigned/changes GET /api/changes`, take the id of the Change whose `input` is `acme/app#10`, then `strata-verify http $R assigned/change GET /api/changes/<id>`. Its `report.stack.selectedPath` is `[9,10,11]`.
- **Yours marker.** `navigate` to `URL/changes/<id>`. `button "Whole stack"` is current, and the Pull requests list row `Show #10 Warm the forecast cache nightly` contains the text `yours`, titled `Yours: review requested from acme/backend`.
- **Not waiting, and other stacks.** On the same page, `heading "Assigned to you, not waiting"` lists `Add the forecast model` with `#3 reviewed by you`. `heading "Other stacks in acme/app"` lists `Add billing admins` (`3 PRs: 3 open by dev`, `Not analysed`), linking to `/repos/acme/app#stack-5`; the stacks from #9 and #1 aren't listed again. Choosing it scrolls the Stacks page to `Stack from #5`, whose `button "Analyse 2 PRs"` makes and runs the Change. Back home, the stack has moved to `heading "Opened by you"`, and on the stack page that path now shows `link "Open"` and `This path already has a Change.`
- **Refresh.** Choose `Refresh`. The note under the heading shows a search step, such as `Searching acme/app`, then `Searched acme/app just now`. No new rows appear and nothing runs again, since no head moved.

## Gotchas

- The search reads GitHub as the token's user, which isn't always the signed-in login. Under the fixture both are `verify-bot`.
- A Change typed in by hand stays under "Changes" (origin `added`) even if it's also assigned. It shows in "Waiting on you" while one of its PRs is listed for you.
- A stack that grows a new PR on top gives a new, longer Change on the next search. The shorter one moves to "Assigned to you, not waiting".

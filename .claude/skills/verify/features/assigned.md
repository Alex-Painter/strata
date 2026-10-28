# Assigned Changes

Strata searches the repos it's told to (`STRATA_ASSIGNED_REPOS`, GlyphicAI/maverick-backend by default) for open PRs that are assigned to the user or ask for their review, directly or through a team. It leaves out the user's own PRs. Each PR becomes the Change for its whole path, the same Change typing it in would give: a lone PR gives a one-PR Change, and one PR in a stack gives the whole stack. The search runs when the server starts, every 10 minutes after that, and on Refresh. New Changes are analysed straight away and again once a head moves. The home page shows them under "Waiting on you", and the workspace marks your PRs "yours".

## Sub-features

- `waiting` lists the Changes with a PR GitHub still lists for you, saying which PR and why.
- `whole-path` means a PR in the middle of a stack gives the Change for the whole path.
- `refresh` starts a search now and shows its progress.
- `earlier` keeps Changes GitHub no longer lists for you under "Earlier assignments".
- `yours-marker` tags your PRs in the workspace's Pull requests list, and the workspace still opens on the whole stack.

## How to get to it (user POV)

- Open the home page. "Waiting on you" sits at the top, with a Refresh button.
- Open a Change from that list. In the sidebar under Pull requests, your PRs say `yours`.

## Driving it with strata-verify

Preconditions:

- One instance from `strata-verify up --github fixture --assigned acme/app`, passing `doctor`. `$R` is its RUN_ID. The fixture lists `#4` as assigned to `verify-bot` and asks for its review on `#10` through the team `acme/backend`. Without `--assigned`, the search is off and the section is hidden.

- **Search status.** `strata-verify http $R assigned/status GET /api/assigned`. A few seconds after start, expect `200` with `"repos":["acme/app"]`, `"running":false`, a `lastFinishedAt` and `"errors":[]`.
- **Waiting on you.** `navigate` to `URL/`, then `read_page`. Expect `heading "Waiting on you"`, `button "Refresh"`, the text `Searched acme/app`, and two rows: `Cache forecasts per account` with `#10 review requested from acme/backend`, and `Fix a typo` with `#4 assigned`, each with `Analysed` once their runs finish. Save it with `strata-verify note $R assigned/home.aria.txt`.
- **Whole path.** `strata-verify http $R assigned/changes GET /api/changes`, take the id of the Change whose `input` is `acme/app#10`, then `strata-verify http $R assigned/change GET /api/changes/<id>`. Its `report.stack.selectedPath` is `[9,10,11]`.
- **Yours marker.** `navigate` to `URL/changes/<id>`. `button "Whole stack"` is current, and the Pull requests list row `Show #10 Warm the forecast cache nightly` contains the text `yours`, titled `Yours: review requested from acme/backend`.
- **Refresh.** Choose `Refresh`. The note under the heading shows a search step, such as `Searching acme/app`, then `Searched acme/app just now`. No new rows appear and nothing runs again, since no head moved.

## Gotchas

- The search reads GitHub as the token's user, which isn't always the signed-in login. Under the fixture both are `verify-bot`.
- A Change typed in by hand stays under "Changes" (origin `added`) even if it's also assigned. It shows in "Waiting on you" while one of its PRs is listed for you.
- A stack that grows a new PR on top gives a new, longer Change on the next search. The shorter one moves to "Earlier assignments".

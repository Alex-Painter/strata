# Approvals

The reviewer can approve a PR on GitHub from Strata, or approve all of a stack's PRs in one step. Each approval goes through a confirm step, and only the second button sends it. Strata sends it as the token's user, and it names the head commit in the report the reviewer sees. Strata blocks an approval while a PR has commits that it did not analyse. It does not offer one on your own PR, a draft, or a merged or closed PR. This is the one place where Strata writes to GitHub.

## Sub-features

- `pr-approve` is `button "Approve"` in a PR's pane, on the status line under its title. After the approval, the line shows `link "Approved by you"` to the review on GitHub.
- `row-approve` is `button "Approve #<n> <title>"` on each PR row of `list "Pull requests"`, shown on hover and focus. An approved row shows a check with the title `Approved by you`.
- `stack-approve` is `button "Approve stack"` above `list "Pull requests"` when the path has more than one PR. Its confirm step lists each PR it approves and each PR it skips, with the reason.
- `confirm` is the confirm step: `dialog "Approve #<n> on GitHub?"` or `dialog "Approve <n> PRs on GitHub?"`, with the login, `#<n> at <short sha>` for each PR, `button "Cancel"` (it has the focus) and `button "Approve on GitHub"`. Escape or a click outside cancels it.
- `blocked` shows the reason in the button's title: new commits since the run, your own PR, a draft.
- `api` is `GET /api/changes/:id/approvals` and `POST /api/changes/:id/approve` with `{ prs: [{ number, headOid }], stack? }`. The POST needs the app's own `Origin` and a JSON body.

## How to get to it (user POV)

- Open a Change. The Change pane shows Approve stack above the Pull requests list.
- Select a PR in the list. Its pane shows Approve beside its review and checks words.

## Driving it with strata-verify

Preconditions:

- One instance from `strata-verify up --github fixture`, passing `doctor`. `$R` is its RUN_ID. Make the Change for `#10` with `strata-verify http $R approve/create POST /api/changes -H 'Content-Type: application/json' -d '{"input":"acme/app#10"}'`, wait for its run, and take its id (`$ID`). Its path is `#9 → #10 → #11`; `#11` is a draft; the fixture's user is `verify-bot` and the PRs are by `dev`.

- **States.** `strata-verify http $R approve/approvals GET /api/changes/$ID/approvals`. Expect `200`, `"viewer":"verify-bot"` and the states `can-approve`, `can-approve`, `draft` for `#9`, `#10`, `#11`.
- **Confirm step sends nothing.** `navigate` to `URL/changes/$ID?pr=10`. Choose `button "Approve"`. Expect `dialog "Approve #10 on GitHub?"` with `#10 at <7 characters of #10's head>`, and no `POST .../approve` request yet. Choose `button "Cancel"`: the dialog goes, and nothing is sent.
- **One PR.** Choose `button "Approve"`, then `button "Approve on GitHub"`. Expect one `POST /api/changes/$ID/approve`, then `link "Approved by you"` on the status line, and a check on the `#10` row. The Status in Details now says `#10 Approved`.
- **Stack.** Choose `button "Approve stack"`. Expect `dialog "Approve #9 on GitHub?"` that lists `#10 You approved it.` and `#11 It is a draft.` under `Strata does not approve these PRs:`. Confirm. Both rows show a check, and `button "Approve stack"` is disabled. On a fresh Change, the dialog is `dialog "Approve 2 PRs on GitHub?"`.
- **Head check.** `strata-verify http $R approve/bad-head POST /api/changes/$ID/approve -H 'Content-Type: application/json' -d '{"prs":[{"number":10,"headOid":"0000000"}]}'`. Expect `409 {"error":"The page shows an earlier run of #10. Open the page again."}`.
- **Own page only.** The same request with `-H 'Origin: https://evil.example'` answers `403 {"error":"Strata accepts an approval only from its own page."}`.

## Gotchas

- The fixture records approvals in memory. A new `up` starts with none.
- The fixture cannot move a PR's head, so the `head-moved` state and the blocked Approve stack are proved by the server and web tests, not here.
- Never approve a real PR to verify this. With `--github gh` every approval goes to GitHub.

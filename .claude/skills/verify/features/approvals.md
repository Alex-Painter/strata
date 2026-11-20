# Approvals and reviews

The reviewer can approve a PR on GitHub from Strata, or approve all of a stack's PRs in one step. A click sends the approval straight away, and the button shows a spinner and `Approving…` until GitHub answers. Strata sends it as the token's user, and it names the head commit in the report the reviewer sees. Strata blocks an approval while a PR has commits that it did not analyse. It does not offer one on your own PR, a draft, or a merged or closed PR. Each PR's pane also has a review box, after Linear's review composer, that sends one GitHub review with a summary, the comments waiting in the PR's review, and an event. Approvals and reviews are the only places where Strata writes to GitHub.

## Sub-features

- `review-box` is `region "Review #<n>"` at the top of a PR's pane, under its title: a chip with the number of pending comments (`No comments yet`, `1 comment`), `textbox "Review summary"` (placeholder `Add review summary…`), the pending comments (each with its place, `Edit`, and `button "Remove the comment on <place>"`), and `button "Only comment"`, `button "Request changes"`, `button "Approve"`. Only comment and Request changes need a summary or a comment. Own PRs, drafts and merged or closed PRs take only comments; a PR with new commits since the run takes nothing, with the note `New commits since the run. Run Strata again to review this PR.` After a review, the box shows `link "Review sent to GitHub"` (or `Approved on GitHub`, `Changes requested on GitHub`), and an approved head shows `link "Approved by you"`.
- `pr-approve` is the box's `button "Approve"`.
- `row-approve` is `button "Approve #<n> <title>"` on each PR row of `list "Pull requests"`, shown on hover and focus. An approved row shows a check with the title `Approved by you`.
- `stack-approve` is `button "Approve stack"` above `list "Pull requests"` when the path has more than one PR. Its title lists the PRs it approves and each PR it skips, with the reason.
- `sending` is the in-flight state: the button is disabled with `aria-busy="true"` and a spinner; the stack's button says `Approving…`. There is no confirm step.
- `blocked` shows the reason in the button's title: new commits since the run, your own PR, a draft.
- `api` is `GET /api/changes/:id/approvals` and `POST /api/changes/:id/approve` with `{ prs: [{ number, headOid }], stack? }`; `POST /api/changes/:id/review` with `{ pr, headOid, event, body, commentIds }` (event `COMMENT`, `REQUEST_CHANGES` or `APPROVE`), one GraphQL `addPullRequestReview` with line comments as threads and comments on the PR as a whole after the summary; `GET /api/changes/:id/comments`, `PATCH` and `DELETE /api/comments/:id`. The POSTs need the app's own `Origin` and a JSON body.

## How to get to it (user POV)

- Open a Change. The Change pane shows Approve stack above the Pull requests list.
- Select a PR in the list. Its pane shows the review box under its title.

## Driving it with strata-verify

Preconditions:

- One instance from `strata-verify up --github fixture`, passing `doctor`. `$R` is its RUN_ID. Make the Change for `#10` with `strata-verify http $R approve/create POST /api/changes -H 'Content-Type: application/json' -d '{"input":"acme/app#10"}'`, wait for its run, and take its id (`$ID`). Its path is `#9 → #10 → #11`; `#11` is a draft; the fixture's user is `verify-bot` and the PRs are by `dev`.

- **States.** `strata-verify http $R approve/approvals GET /api/changes/$ID/approvals`. Expect `200`, `"viewer":"verify-bot"` and the states `can-approve`, `can-approve`, `draft` for `#9`, `#10`, `#11`.
- **One PR.** `navigate` to `URL/changes/$ID?pr=10`. Choose the review box's `button "Approve"`. Expect no dialog, a spinner on the button while the request is in flight, one `POST /api/changes/$ID/review`, then `link "Approved on GitHub"` and `link "Approved by you"` in the box, and a check on the `#10` row. The Status in Details now says `#10 Approved`.
- **Stack.** `button "Approve stack"` has the title `Approve #9 on GitHub`, then `Skips #10: You approved it.` and `Skips #11: It is a draft.` on their own lines. Choose it. Expect no dialog and one `POST`. Both rows show a check, and `button "Approve stack"` is disabled. On a fresh Change, the title starts `Approve #9, #10 on GitHub`.
- **Review.** Ask `Comment on #9 about the riskiest line` (see `features/chat.md`), open `?pr=9`, fill `textbox "Review summary"` and choose `button "Only comment"`. Expect one `POST /api/changes/$ID/review`, `link "Review sent to GitHub"`, `No comments yet`, and `Sent to GitHub` on both cards in Ask.
- **Head check.** `strata-verify http $R approve/bad-head POST /api/changes/$ID/approve -H 'Content-Type: application/json' -d '{"prs":[{"number":10,"headOid":"0000000"}]}'`. Expect `409 {"error":"The page shows an earlier run of #10. Open the page again."}`.
- **Own page only.** The same request with `-H 'Origin: https://evil.example'` answers `403 {"error":"Strata accepts an approval only from its own page."}`.

## Gotchas

- The fixture records approvals in memory. A new `up` starts with none.
- The fixture cannot move a PR's head, so the `head-moved` state and the blocked Approve stack are proved by the server and web tests, not here.
- Never approve a real PR to verify this. With `--github gh` every approval goes to GitHub.

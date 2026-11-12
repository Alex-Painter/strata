# Usage

The Usage page shows what Strata sent to Claude in the last 7, 30 or 90 days, and its estimated cost. It groups the cost by day, by feature (Layers, PR summaries, Whole-stack summary and Guide, Ask) and by Change. With an Admin API key on the server, it also shows the amount that Anthropic bills. The numbers come from `llm-usage.jsonl` in the data folder, the same file that `strata usage` reads. The page makes no Claude request.

## Sub-features

- `nav` is `link "Usage"` in the home sidebar, between Changes and Settings. It opens `/usage`.
- `period` is the `group "Period"` with `button "7 days"`, `button "30 days"` (pressed by default) and `button "90 days"`.
- `totals` shows Estimated cost, Requests to Claude and Answers from the cache. With an admin key it adds Billed by Anthropic; when Strata cannot read that amount, an alert starts `Strata cannot read the billed amount.`
- `chart` is `list "Cost each day"`, one item a day, oldest first. Each item's title is `<day>: $<cost> (<feature> $<cost>, …)`.
- `features` is the By feature table: Feature, Model, Requests, Cached, Cost, Share. The Cost cell's title gives the input and output tokens.
- `changes` is the By Change table. A row links to its Change. `No Change recorded` holds requests from before 2026-11-12 and requests without a Change.
- `api` is `GET /api/usage?days=7|30|90`. Any other `days` answers 400 `Set days to 7, 30 or 90.`

## How to get to it (user POV)

- Select Usage in the sidebar of the home page or the Settings page.

## Driving it with strata-verify

Preconditions: `up --github fixture --claude fixture`, then add a Change (`POST /api/changes` with `{"input":"acme/app#3"}`) and wait for its run, thus the log has lines.

- api: `strata-verify http <run> usage/api GET '/api/usage?days=30'`. Expect 200, `byTask` with `whole-summary`, `pr-summary` and `layers`, and a `byChange` row with the Change's id and title. The fixture Claude reports 0 tokens, thus every cost is $0.00.
- bad period: `strata-verify http <run> usage/bad GET '/api/usage?days=12'`. Expect 400.
- page: open `<URL>/usage`. Expect the totals, the chart, both tables, and `link "Usage"` with `aria-current="page"`.
- period: select `button "7 days"`. Expect a request for `/api/usage?days=7` and the button pressed.

## Gotchas

- The costs are an estimate from token counts and the prices in `packages/engine/src/llm.ts`. To see non-zero numbers, append lines to `<instance>/data/llm-usage.jsonl`.
- The billed amount needs `ANTHROPIC_ADMIN_KEY` (and `ANTHROPIC_API_KEY_ID` for one key). The verify instance has neither, thus the page shows no billed amount and no alert.

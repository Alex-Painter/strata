# Chat

The reviewer asks Claude about a Change in the side panel's Ask tab. Selecting text in a diff shows an `Ask` button next to it; choosing it adds the selection as a highlight to the next question. Claude answers in a stream. It can read hunks, read any file at the base or head, and search the head, and it cites hunks by id. Strata drops citations of hunks the report does not hold, so each citation button opens a real hunk. Threads are saved on the Change. Chat runs only for repos whose settings let Strata send their code to Claude, and only when Strata has an Anthropic API key.

## Sub-features

- `highlight`: selecting text in a hunk's lines shows `button "Ask Claude about the selection"`. Choosing it opens the Ask tab with the highlight as a chip in `list "Highlights"`. A selection in a PR's own diff points at that PR's hunk.
- `ask`: `textbox "Question"`, Enter to send (Shift+Enter adds a line). The answer streams in, with status lines such as `Claude reads <hunk id>`, and a `Stop` button while it runs.
- `citations`: each `[hunk_…]` in an answer is a button named after the file. Choosing it opens the hunk in its layer, in the whole stack or in its PR.
- `threads`: `combobox "Thread"` lists the Change's threads, newest first, titled by their first question. `New thread` starts another. Threads stay after a reload.
- `older-analysis`: an answer about an earlier run of the Change says `Claude wrote this about an earlier analysis of the Change.`
- `gated`: with the repo's setting off, the tab says `Claude cannot read the code in <repo>. To ask Claude, turn on the setting in Settings.` and links Settings. Without an API key, it says `Strata does not have an Anthropic API key. Thus Claude cannot answer questions.`
- `chat-api`: `GET` and `POST /api/changes/:id/threads`, `GET /api/threads/:id/messages`, and `POST /api/threads/:id/messages` with `{text, anchors}`, which answers with a `text/event-stream` of `status`, `delta`, then `done` (or `error`) events. `403` when the repo does not allow Claude, `409` before the Change has a report, `400` for an empty question.

## How to get to it (user POV)

- Open a Change, open a layer, select some code in a hunk, and choose `Ask`.
- Or open the side panel's `Ask` tab and write a question about the whole Change.

## Driving it with strata-verify

Preconditions:

- One instance from `strata-verify up --github fixture --claude fixture`, passing `doctor`. `$C` is its RUN_ID. The stand-in Claude turns on `sendCodeToAnthropic` for `acme/app`. In chat, it first calls `read_hunk` on the first hunk the digest lists, then answers: `The fixture Claude read one hunk. It cites it [<that hunk>]. It also cites a hunk that does not exist [hunk_ffffffffffffffff].`
- Make the Change for `acme/app#10` (`POST /api/changes`, see stacks.md) and wait for its run to finish.

- **Highlight.** `navigate` to `URL/changes/<id>?layer=logic`. In `app/forecast_cache.py`, select `timedelta(hours=6)` on line 3 (the browser tool's drag, or a script that sets the selection and sends `mouseup`). `button "Ask Claude about the selection"` shows under it. Choose it: `tab "Ask"` is selected, and `list "Highlights"` holds `app/forecast_cache.py`.
- **Ask.** Fill `textbox "Question"` with `Why six hours?` and press Enter. One `POST /api/changes/<id>/threads` and one `POST /api/threads/<thread>/messages` go out. The question shows with its highlight (`app/forecast_cache.py` and `timedelta(hours=6)`), then the answer `The fixture Claude read one hunk. It cites it 0042_forecast_cache.sql. It also cites a hunk that does not exist.`: the made-up citation is gone, and the real one is a button.
- **Citation.** Choose `button "0042_forecast_cache.sql"`. The URL gets `?layer=data-model`, and that hunk is selected (`data-selected="true"`).
- **Threads.** Reload and choose `tab "Ask"`. `combobox "Thread"` shows `Why six hours?` with the same question and answer.
- **API.** `strata-verify http $C chat/messages GET /api/threads/<thread>/messages` returns the two messages; the user message carries its anchor (`source.kind` `hunk`) and `analysedAt`. `strata-verify http $C chat/ask POST /api/threads/<thread>/messages -H 'Content-Type: application/json' -d '{"text":"And the tests?","anchors":[]}'` returns `200`, `content-type: text/event-stream`, and the events `status` (`Claude reads hunk_…`), `delta`, `delta`, `done`.
- **Gated.** Write `{"sendCodeToAnthropic":false}` to `<run dir>/instance/data/settings/acme/app.json`. The same POST returns `403` with `Turn on "Send the code in acme/app to Claude" in Settings to ask Claude.`, and the Ask tab shows the Settings link.

Save each `read_page` tree with `strata-verify note $C chat/<step>.aria.txt`, with the URL you were on.

## Gotchas

- The `Ask` button shows only for a selection inside one hunk's lines. A selection across two hunks, or on the header, shows nothing.
- The stand-in Claude's answer is the same every time. It tests the plumbing (highlights, the stream, the tool call, dropping bad citations, threads), not how good real answers are. Judge those with a real key on a real stack.
- Without `--claude fixture` the instance has no API key, so the tab shows the API key message.

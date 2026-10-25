# App shell and navigation

Once signed in, the user lands on the Changes page: a top bar with the Strata home link, their login and Sign out, and an empty-state card, because listing Changes arrives with milestone 1. Opening `/changes/<id>` shows the review workspace layout: a navigator on the left, panes in the centre, chat on the right. Unknown client routes show "Page not found." The server serves the same app shell for every client route, and serves fingerprinted assets with long-lived caching.

## Sub-features

- `changes-empty` is the Changes page with its empty-state copy.
- `workspace-layout` is the workspace at `/changes/:id`: the `Change` navigator sections and the `Chat` panel.
- `home-link` is the `Strata` link in the top bar, which goes back to `/`.
- `not-found` is the client-side "Page not found." for unknown routes.
- `shell-caching` covers the shell's `no-cache` and the assets' `immutable` caching, plus the security headers.

## How to get to it (user POV)

- Open Strata at `/` while signed in.
- Open a link or type the URL `/changes/<id>`.
- Choose `Strata` in the top bar from any page.
- Type any other path, for example `/nope`.

## Driving it with strata-verify

Preconditions:

- One instance from `strata-verify up` (bypass mode), passing `doctor`. `$B` stands for its RUN_ID and `URL` for its URL.

- **Changes page.** `navigate` to `URL/`, then `read_page`. Expect `heading "Changes"`, the text `No changes yet. Point Strata at a PR, a stack of PRs or a commit range to review one.`, `link "Strata"`, the text `verify-bot` and `button "Sign out"`. Save it with `strata-verify note $B app-shell/changes.aria.txt`.
- **Workspace layout.** `navigate` to `URL/changes/abc`, then `read_page`. Expect `navigation "Change"` with the section labels `Overview`, `Context`, `Layers`, `Diagrams`, `Findings` and `Intent ledger`. Also expect `complementary "Chat"` containing `Highlight anything in the spec, the code or a diagram, then ask about it here.` The top bar title reads `Change`.
- **Home link.** From the workspace, `find` "Strata" (the link) and click it. The URL becomes `URL/` and `heading "Changes"` appears, with no full page reload needed.
- **Not found.** `navigate` to `URL/nope`. The page shows `Page not found.`
- **Server side of routing.** `strata-verify http $B app-shell/deep-link GET /changes/abc` returns `200`, `cache-control: no-cache` and a body containing `<title>Strata</title>`.
- **Asset caching.** Take an `/assets/...js` path from the body of `/`, then `strata-verify http $B app-shell/asset GET /assets/<file>.js`. Expect `200` and `cache-control: public, max-age=31536000, immutable`.
- **Security headers.** `strata-verify http $B app-shell/headers GET /` includes `x-frame-options: SAMEORIGIN`, `x-content-type-options: nosniff` and `referrer-policy: no-referrer`.

## Gotchas

- The workspace's centre panes and the navigator's section contents are placeholders until milestone 1. Don't treat their emptiness as a bug. Once `GET /api/changes/:id` is real, this file needs a recipe that opens an actual Change.
- The CLI's static page (`dist-static/index.html` with an embedded `#strata-report`) renders the same workspace in `static` mode, and its Chat says `This page is a snapshot. Chat needs the Strata server.` The CLI can't write that page until milestone 1, so it isn't verifiable end to end yet. Add a feature file for it when `strata analyze` produces output.
- If the page shows `Couldn't reach the Strata server: ...`, `/api/me` failed with something other than 401. Run `doctor`.

# App shell and navigation

Once signed in, the user lands on the home page: a top bar with the Strata home link, their login and Sign out, then "Review a stack", "Browse a repo's stacks" and the list of their Changes. Opening `/changes/<id>` shows the review workspace: the stack map as a rail on the left, panes in the centre, chat on the right. Unknown client routes show "Page not found." The server serves the same app shell for every client route, and serves fingerprinted assets with long-lived caching. What the home page and the workspace do with real stacks is in [stacks.md](./stacks.md).

## Sub-features

- `changes-empty` is the home page with no Changes yet.
- `workspace-missing` is the workspace at `/changes/<id>` for an id that doesn't exist.
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

- **Home page.** `navigate` to `URL/`, then `read_page`. Expect `heading "Review a stack"` with `textbox "PR or branch"` and a disabled `button "Review"`, `heading "Browse a repo's stacks"` with `textbox "Repository"`, and `heading "Changes"` with the text `No Changes yet. Give Strata a PR above, or pick a stack from a repo.` Also `link "Strata"`, the text `verify-bot` and `button "Sign out"`. Save it with `strata-verify note $B app-shell/changes.aria.txt`.
- **Missing Change.** `navigate` to `URL/changes/abc`. The page shows `Not found.` under a top bar titled `Change`.
- **Home link.** From that page, `find` "Strata" (the link) and click it. The URL becomes `URL/` and `heading "Review a stack"` appears, with no full page reload needed.
- **Not found.** `navigate` to `URL/nope`. The page shows `Page not found.`
- **Server side of routing.** `strata-verify http $B app-shell/deep-link GET /changes/abc` returns `200`, `cache-control: no-cache` and a body containing `<title>Strata</title>`.
- **Asset caching.** Take an `/assets/...js` path from the body of `/`, then `strata-verify http $B app-shell/asset GET /assets/<file>.js`. Expect `200` and `cache-control: public, max-age=31536000, immutable`.
- **Security headers.** `strata-verify http $B app-shell/headers GET /` includes `x-frame-options: SAMEORIGIN`, `x-content-type-options: nosniff` and `referrer-policy: no-referrer`.

## Gotchas

- The workspace needs a real Change to show anything more; [stacks.md](./stacks.md) opens one against the fixture GitHub.
- The CLI's static page (`dist-static/index.html` with an embedded `#strata-report`) renders the same workspace in `static` mode, and its Chat says `This page is a snapshot. Chat needs the Strata server.` [cli.md](./cli.md) writes one and compares it with the workspace.
- If the page shows `Couldn't reach the Strata server: ...`, `/api/me` failed with something other than 401. Run `doctor`.

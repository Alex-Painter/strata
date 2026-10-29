# App shell and navigation

Once signed in, the user lands on the home page. Every page shares one frame: a sidebar with the Strata home link and the `Changes` and `Settings` pages at the top, and their login, a theme switch and Sign out at the bottom, and one card with a 44 px top bar (a breadcrumb) holding the page. The home page has "Review a stack", "Browse a repo's stacks" and the list of their Changes; its sidebar lists the repos they've reviewed. Opening `/changes/<id>` shows the review workspace: page links in the sidebar, then a resizable, collapsible Change pane with Whole stack, the layers and the stack graph of pull requests, the canvas in the centre, details on the right. Unknown client routes show "Page not found." The server serves the same app shell for every client route, and serves fingerprinted assets with long-lived caching. What the home page and the workspace do with real stacks is in [stacks.md](./stacks.md).

## Sub-features

- `changes-empty` is the home page with no Changes yet.
- `workspace-missing` is the workspace at `/changes/<id>` for an id that doesn't exist.
- `home-link` is the `Strata` link at the top of the sidebar, which goes back to `/`.
- `sidebar-collapse` is `button "Collapse the sidebar"` at the top of the sidebar. It hides the sidebar and puts `button "Expand the sidebar"` at the left of the top bar. The browser keeps the choice. Below 960 px the sidebar is a drawer behind `button "Menu"` instead, and neither button shows.
- `not-found` is the client-side "Page not found." for unknown routes.
- `shell-caching` covers the shell's `no-cache` and the assets' `immutable` caching, plus the security headers.

## How to get to it (user POV)

- Open Strata at `/` while signed in.
- Open a link or type the URL `/changes/<id>`.
- Choose `Strata` at the top of the sidebar from any page.
- Type any other path, for example `/nope`.

## Driving it with strata-verify

Preconditions:

- One instance from `strata-verify up` (bypass mode), passing `doctor`. `$B` stands for its RUN_ID and `URL` for its URL.

- **Home page.** `navigate` to `URL/`, then `read_page`. Expect `heading "Waiting on you"` with the text `Nobody assigned a stack to you at this time.` and `heading "Assigned to you, not waiting"` with `There are no stacks here at this time.` (the assignment search is off without `--assigned`, so there's no Refresh). Also `link "Strata"`, the text `verify-bot`, `button "Switch theme"` and `button "Sign out"`. Save it with `strata-verify note $B app-shell/changes.aria.txt`.
- **Missing Change.** `navigate` to `URL/changes/abc`. The page shows `Not found.` under a breadcrumb `Changes › Change`.
- **Home link.** From that page, `find` "Strata" (the link) and click it. The URL becomes `URL/` and `heading "Waiting on you"` appears, with no full page reload needed.
- **Sidebar collapse.** Choose `button "Collapse the sidebar"`. `navigation "Strata"` goes, the card fills the window, and `button "Expand the sidebar"` shows before the breadcrumb. Reload: it stays collapsed. Choose `Expand the sidebar` to bring it back.
- **Not found.** `navigate` to `URL/nope`. The page shows `Page not found.`
- **Server side of routing.** `strata-verify http $B app-shell/deep-link GET /changes/abc` returns `200`, `cache-control: no-cache` and a body containing `<title>Strata</title>`.
- **Asset caching.** Take an `/assets/...js` path from the body of `/`, then `strata-verify http $B app-shell/asset GET /assets/<file>.js`. Expect `200` and `cache-control: public, max-age=31536000, immutable`.
- **Security headers.** `strata-verify http $B app-shell/headers GET /` includes `x-frame-options: SAMEORIGIN`, `x-content-type-options: nosniff` and `referrer-policy: no-referrer`.

## Gotchas

- The workspace needs a real Change to show anything more; [stacks.md](./stacks.md) opens one against the fixture GitHub.
- The CLI's static page (`dist-static/index.html` with an embedded `#strata-report`) renders the same workspace in `static` mode, and its `tab "Ask"` is disabled, titled `This page is a snapshot. Questions need the Strata server.` [cli.md](./cli.md) writes one and compares it with the workspace.
- If the page shows `Strata cannot connect to its server: ...`, `/api/me` failed with something other than 401. Run `doctor`.

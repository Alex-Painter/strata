# Sign-in

A signed-out visitor sees a Strata sign-in card with a single "Sign in with GitHub" link. The link sends them to GitHub's OAuth consent page, and a failed or interrupted sign-in brings them back with an explanation. In local development the dev bypass skips GitHub entirely and signs them in as a configured login. Sign-out is in the top bar.

## Sub-features

- `signin-screen` shows the signed-out card when there is no session.
- `signin-redirect` sends `/auth/login` to GitHub's authorize URL with a state cookie.
- `signin-errors` shows the right message for `auth_error=invalid_state|github_error|not_allowed`, and a generic one for anything else.
- `signin-bypass` signs in automatically as `DEV_GITHUB_LOGIN`; `/auth/login` just returns home.
- `signout` clears the session cookie and reloads.

## How to get to it (user POV)

- Open Strata while signed out. The sign-in card is shown at every path.
- Choose `Sign in with GitHub` on the card.
- Come back from GitHub after a failed sign-in, which lands on `/?auth_error=<reason>`.
- Choose `Sign out` in the top bar while signed in.

## Driving it with strata-verify

Preconditions:

- One instance from `strata-verify up --mode oauth` (signed out) and one from `strata-verify up` (bypass), both passing `doctor`. `$O` and `$B` stand for their RUN_IDs, and `OAUTH_URL` and `BYPASS_URL` for their URLs.

- **Signed-out screen.** Open the app signed out. `navigate` to `OAUTH_URL/`, then `read_page`. The tree has `heading "Strata"`, the text `Review the system change, not just the diff.` and `link "Sign in with GitHub"` with `href="/auth/login"`. Save it with `strata-verify note $O sign-in/screen.aria.txt`.
- **Any path is gated.** `navigate` to `OAUTH_URL/changes/abc`. You get the same sign-in card, not the workspace.
- **Redirect to GitHub.** Follow the link without leaving localhost: `strata-verify http $O sign-in/login-redirect GET /auth/login`. Expect `302` with `location: https://github.com/login/oauth/authorize?...client_id=verify-dummy-client...&scope=repo+read%3Auser&redirect_uri=http%3A%2F%2Flocalhost%3A<port>%2Fauth%2Fcallback`, plus `set-cookie: strata_oauth_state=...; Path=/auth; HttpOnly; SameSite=Lax`.
- **Interrupted sign-in.** `strata-verify http $O sign-in/callback-bad-state GET '/auth/callback?code=x&state=y'` returns `302` with `location: /?auth_error=invalid_state`. Then `navigate` to `OAUTH_URL/?auth_error=invalid_state`: the card shows `Sign-in expired or was interrupted. Try again.` above the link.
- **Other error messages.** `navigate` to `?auth_error=not_allowed`, which should show `That GitHub account isn't on this Strata's allowlist.` Then `?auth_error=github_error`, which should show `GitHub didn't complete the sign-in. Try again.` Then `?auth_error=whatever`, which should show `Sign-in failed.`
- **Dev bypass.** `navigate` to `BYPASS_URL/`. The top bar shows `verify-bot` and `button "Sign out"`, and the page has `heading "Changes"`. `strata-verify http $B sign-in/bypass-login GET /auth/login` returns `302` with `location: /`.
- **Sign out.** API: `strata-verify http $B sign-in/logout POST /auth/logout -H 'Content-Type: application/json' -d '{}'` returns `204` with `set-cookie: strata_session=; Max-Age=0; Path=/`. UI: `find` "Sign out", click it, and the page reloads at `/`. `read_network_requests` with `urlPattern` `/auth/logout` shows `POST .../auth/logout → 204`. A trailing `ERR_ABORTED` is just the reload cancelling the finished request. With the bypass on you are still `verify-bot`. That's expected: the bypass has no session to end. Proving sign-out leaves a user signed out needs a real GitHub session, so report it as unverified locally.

## Gotchas

- Never click `Sign in with GitHub` in the oauth instance. It goes to github.com with a dummy client ID and gets a GitHub error page. Prove the redirect from the `location` header instead.
- A successful callback (`/auth/callback` with a valid code) can't be driven locally. It needs a real GitHub OAuth app and a person to approve it. Report it as unverified.
- The bypass is ignored when `NODE_ENV=production`. That's covered by unit tests in `apps/server/src/config.test.ts`, not by this map.
- `/auth/*` paths the server doesn't know answer JSON `404 {"error":"Not found."}`, never the app shell.

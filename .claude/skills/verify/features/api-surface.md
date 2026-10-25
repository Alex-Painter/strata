# API surface

The JSON API is what the web app, and later other clients, talk to. The live parts are the health check, the signed-in user (`/api/me`), the auth gate on every `/api` route, the CSRF origin check, and the stack and Changes routes (their recipe is in [stacks.md](./stacks.md)). The other milestone-1 routes already exist at their final paths and answer `501 {"error":"Not implemented yet (milestone 1)."}` so clients can be wired up early.

## Sub-features

- `healthz`: `GET /healthz` returns `{"ok":true}` after a database round trip.
- `me`: `GET /api/me` returns `{login, name, avatarUrl}` for the signed-in user.
- `auth-gate`: every `/api/*` route answers `401 {"error":"Sign in required."}` without a session, the 501 stubs included.
- `stubs-501`: the declared milestone-1 routes answer 501 when signed in.
- `unknown-404`: an unknown `/api` path answers JSON `404 {"error":"Not found."}`, never the HTML app shell.
- `csrf`: cross-site form posts are refused with 403.

## How to get to it (user POV)

- A deploy health check or a person runs `curl <host>/healthz`.
- The web app calls `/api/me` on every load to decide between the sign-in screen and the Changes page.
- Any API client requests the routes below with the session cookie.

## Driving it with strata-verify

Preconditions:

- One bypass instance (`$B`) and one oauth instance (`$O`), both passing `doctor`.

- **Health.** `strata-verify http $B api/healthz GET /healthz` returns `200 {"ok":true}`.
- **Signed-in user.** `strata-verify http $B api/me GET /api/me` returns `200 {"login":"verify-bot","name":"verify-bot","avatarUrl":null}`.
- **Auth gate.** `strata-verify http $O api/me-signed-out GET /api/me` returns `401 {"error":"Sign in required."}`. So do `strata-verify http $O api/changes-signed-out GET /api/changes` and `GET /api/changes/abc/threads`: the gate runs before any route, stubs included.
- **Still-501 routes.** Each of these returns `501 {"error":"Not implemented yet (milestone 1)."}` on `$B`. POST requests need `-H 'Content-Type: application/json' -d '{}'`.
  - `POST /api/changes/abc/sources`, `DELETE /api/changes/abc/sources/src1`, `GET /api/changes/abc/files`
  - `GET /api/changes/abc/threads`, `POST /api/changes/abc/threads`, `GET /api/threads/t1/messages`, `POST /api/threads/t1/messages`

  When one becomes real, move it out of this list and give it its own recipe.
- **Unknown API path.** `strata-verify http $B api/unknown-path GET /api/nope` returns `404` with `content-type: application/json` and `{"error":"Not found."}`. On `$O`, the same path returns `401 {"error":"Sign in required."}`, because the auth gate runs first.
- **CSRF.** Send a cross-site form post with `strata-verify capture $B api/csrf -- curl -sS -i -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/x-www-form-urlencoded' -d a=1 <URL>/auth/logout`. Expect `403`. The same-origin POST made by `strata-verify http` returns 204, which is covered in `sign-in.md`.

## Gotchas

- Unknown `/api` paths must be checked with the web build being served, which `strata-verify` always does. Without a web build, the server's own 404 would hide a regression in which the app shell answers API paths.
- `strata-verify http` always sends a same-origin `Origin`. To test cross-origin behaviour, use `capture` with your own `curl`.
- `/healthz` isn't behind auth and is what Railway's health check calls, so keep it cheap.

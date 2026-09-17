# Deploying the Partner Portal to Vercel

This repo **is** the portal — the Vite app sits at the repo root, so Vercel's
Root Directory can be left at its default.

---

## How requests reach Frappe

The portal is a decoupled SPA, but it does **not** call the bench cross-origin.
`vercel.json` proxies three paths straight through to
`shotright.thedaystar.co.za`:

```
/api/*      ->  https://shotright.thedaystar.co.za/api/*
/files/*    ->  https://shotright.thedaystar.co.za/files/*
/private/*  ->  https://shotright.thedaystar.co.za/private/*
```

Everything else falls through to `/index.html` so client-side routing works on a
hard refresh (`/venues/new` typed directly into the address bar must not 404).

This mirrors what `vite.config.js` already does in development, and it matters
for more than tidiness:

- **No CORS.** The browser only ever sees its own origin, so the bench needs no
  `allow_cors` entry and no preflight handling.
- **No bench-side config.** `allow_cors` never has to be set, because there is
  never a cross-origin request to allow.

> **Auth is token-based, not cookie-based.** `shotright.api.login` returns an
> `api_key`/`api_secret` pair sent as an `Authorization: token …` header, held in
> `sessionStorage`. There is no session cookie, so the `SameSite`/`Domain=`
> failure mode that this section previously warned about does not apply at all.
> With tokens a direct cross-origin call would also work if the bench set
> `allow_cors`; the proxy is kept because it needs no bench change.

---

## First deploy

1. **Import this repo** at [vercel.com/new](https://vercel.com/new) →
   `Mlu-ctrl-alt-design/shotright-portal`.
2. Leave **Root Directory** at the repo root. Framework preset auto-detects as
   Vite; build command `npm run build`, output `dist`.
3. **Set environment variables** (see below).
4. Deploy.

### Environment variables

| Variable | Value | Why |
|---|---|---|
| `VITE_USE_MOCKS` | `true` *(for now)* | The backend **is** live at `shotright.thedaystar.co.za`, but several things a partner can enter have nowhere to be stored yet — see `docs/BACKEND-INTEGRATION.md` §2, particularly moods (C1) and venue coordinates. Keep `true` until those are closed, or partners will submit venues that silently lose data and cannot be found by radius search. |
| `VITE_API_BASE` | *(leave empty)* | Requests go to `/api/...` on the portal's own origin and `vercel.json` proxies them. Setting this to the full bench URL forces direct cross-origin calls and re-introduces the CORS and cookie problems above. |
| `VITE_GOOGLE_CLIENT_ID` | the OAuth **web** client ID | Without it the Google sign-in button is not hidden — it is **compiled out**. See "Google credentials" below. |
| `VITE_GOOGLE_MAPS_API_KEY` | the Maps JS API key | Without it the wizard's map picker never loads and venues can be saved with no coordinates, which makes them invisible to the radius search. |

`VITE_FRAPPE_URL` is only read by `vite.config.js` for the **dev** proxy. It has
no effect on a Vercel build; the production target is the one hard-coded in
`vercel.json`.

---

## Google credentials

Both Google variables are **inlined by Vite at build time**, which is the single
most important thing to know about them: they do not behave like runtime config.

### The failure they cause is silent

Unset, `import.meta.env.VITE_GOOGLE_CLIENT_ID` folds to `""`. The guard in
`GoogleSignInButton.jsx` — `if (!GOOGLE_CLIENT_ID) return null` — becomes
constant-true, and the bundler removes the script load, the
`google.accounts.id.initialize` call and the button markup as dead code. The
chunk that shipped to production was 249 bytes of a component that returns
`null` on every path.

There is no console error and no failed request, because no code survives to
produce one. It is indistinguishable from a feature that was never built — and
was mistaken for exactly that for three weeks while the bench half sat finished
and working.

`VITE_GOOGLE_MAPS_API_KEY` fails the same quiet way, and costs more: a venue
saved without coordinates does not appear in the radius search that customers
use, so the listing is live and unfindable.

**Setting either variable in the Vercel dashboard changes nothing until a build
runs.** Redeploy after adding them.

### The client ID must match what the bench accepts

The portal's ID is checked against the `aud` claim server-side. The bench builds
its allowed list from two places:

- the `shotright_google_client_ids` site_config key (a JSON list), and
- the `client_id` on the `Social Login Key` record named `google`.

The **web** client ID belongs in `VITE_GOOGLE_CLIENT_ID`. Native app client IDs
(Android, iOS) carry a different `aud` and must be added to the site_config list
or every mobile sign-in is rejected:

```bash
bench --site <site> set-config -p shotright_google_client_ids \
  '["<web-client-id>","<android-client-id>","<ios-client-id>"]'
```

### Authorized JavaScript origins

In Google Cloud Console → Credentials → the OAuth client, **Authorized
JavaScript origins** must list every origin the portal is served from:

- `https://partners.thedaystar.co.za` (or whichever subdomain is live)
- `https://shotright-portal.vercel.app`
- `http://localhost:5173` for local work

A missing origin is the one failure mode here that *is* loud: the button renders
and then fails at `initialize` with an origin error in the console.

---

## Use a subdomain, not the `.vercel.app` URL

For anything beyond internal review, point a subdomain of the existing domain at
the deployment — for example **`partners.thedaystar.co.za`**.

Two reasons:

1. **Partner trust.** Restaurant owners are being asked to type a password. A
   `shotright-portal-git-main-xyz.vercel.app` URL does not read as legitimate.
2. **It keeps the cookie story simple even if the proxy is ever removed.**
   `partners.thedaystar.co.za` and `shotright.thedaystar.co.za` share a registrable
   domain, so they are *same-site*. A normal `SameSite=Lax` session cookie is
   sent on those requests. From `*.vercel.app` it is not.

In Vercel: **Project → Settings → Domains → Add**, then create the DNS record it
gives you (a `CNAME` to `cname.vercel-dns.com`).

---

## Preview deployments

Vercel builds every branch and pull request. Those preview URLs proxy to the
**same production bench**, so while `VITE_USE_MOCKS=false` any preview can write
real data. Two options once the backend is live:

- Set `VITE_USE_MOCKS=true` for the Preview environment only, so previews stay on
  fixtures and production talks to the bench, or
- Stand up a staging bench and point a preview-scoped rewrite at it.

Worth deciding before the first `false` deploy rather than after.

---

## Checks before calling it done

- [ ] Build succeeds and the site loads
- [ ] `/venues/new` typed directly into the address bar loads the wizard (SPA fallback works)
- [ ] Login completes and survives a hard refresh (token is being stored)
- [ ] Custom subdomain resolves over HTTPS
- [ ] `VITE_USE_MOCKS` is the value you actually intended for that environment
- [ ] The Google sign-in button is **visible** on `/login` — if it is absent, `VITE_GOOGLE_CLIENT_ID` was missing at build time
- [ ] The wizard's map picker loads a map rather than falling back to manual coordinates
- [ ] Both Google variables were set **before** the build that shipped, not after

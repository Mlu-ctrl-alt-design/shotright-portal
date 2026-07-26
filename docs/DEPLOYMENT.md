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

`VITE_FRAPPE_URL` is only read by `vite.config.js` for the **dev** proxy. It has
no effect on a Vercel build; the production target is the one hard-coded in
`vercel.json`.

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

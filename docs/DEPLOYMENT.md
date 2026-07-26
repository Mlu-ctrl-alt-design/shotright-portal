# Deploying the Partner Portal to Vercel

This repo **is** the portal — the Vite app sits at the repo root, so Vercel's
Root Directory can be left at its default.

---

## How requests reach Frappe

The portal is a decoupled SPA, but it does **not** call the bench cross-origin.
`vercel.json` proxies three paths straight through to
`bloop.thedaystar.co.za`:

```
/api/*      ->  https://bloop.thedaystar.co.za/api/*
/files/*    ->  https://bloop.thedaystar.co.za/files/*
/private/*  ->  https://bloop.thedaystar.co.za/private/*
```

Everything else falls through to `/index.html` so client-side routing works on a
hard refresh (`/venues/new` typed directly into the address bar must not 404).

This mirrors what `vite.config.js` already does in development, and it matters
for more than tidiness:

- **No CORS.** The browser only ever sees its own origin, so the bench needs no
  `allow_cors` entry and no preflight handling.
- **No third-party cookies.** Frappe's `sid` cookie is host-only, so when the
  response is proxied the browser stores it against the Vercel domain and
  replays it on the next `/api` call. A direct browser→bench call from a
  `*.vercel.app` origin would be cross-site, needing `SameSite=None; Secure` —
  exactly the pattern browsers are busy switching off.

> **Verify this once on the first real deploy.** If Frappe is configured to set
> an explicit `Domain=bloop.thedaystar.co.za` on the session cookie, the browser
> will reject it on the Vercel origin and login will silently fail. The fix is to
> drop the `Domain` attribute so the cookie stays host-only.

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
| `VITE_USE_MOCKS` | `true` *(for now)* | The Sho't Right doctypes do not exist on the bench yet. Leave this `true` and the portal runs end-to-end on in-memory fixtures — which is what makes it useful as a review link today. Flip to `false` once the backend app is installed. |
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
   `partners.thedaystar.co.za` and `bloop.thedaystar.co.za` share a registrable
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
- [ ] Login completes and survives a hard refresh (session cookie is being stored)
- [ ] Custom subdomain resolves over HTTPS
- [ ] `VITE_USE_MOCKS` is the value you actually intended for that environment

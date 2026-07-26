# Backend integration — status and gaps

**The backend exists.** The `shotright` Frappe app is deployed at
**`shotright.thedaystar.co.za`** (not `bloop`, which earlier notes referenced).
The portal is wired to it. This document records what is connected, what is not,
and what has to change before `VITE_USE_MOCKS=false` is safe.

Source of truth: the Sho't Right API Postman collection.

---

## 1. What changed when the real API arrived

Three assumptions the portal was built on turned out to be wrong. All three are
now corrected in code.

### Auth is token-based, not cookie-based

`shotright.api.login` returns a reusable `api_key`/`api_secret` pair, sent as:

```
Authorization: token <api_key>:<api_secret>
```

Consequences, all handled in `src/services/api.js`:

- **No session cookie, so no CSRF token.** The `X-Frappe-CSRF-Token` handling is
  gone.
- **The cookie `Domain=` risk in the deployment notes no longer applies.** That
  was the thing most likely to break cutover; it is now moot.
- **The token is a long-lived bearer secret.** It is kept in `sessionStorage`, so
  it dies with the tab rather than lingering on a shared machine. Any script on
  the origin can read it — the mitigation is that the portal loads no
  third-party scripts. Adding one is a security decision, not a build decision.
- **"Remember me" cannot survive a browser restart** without moving the secret to
  `localStorage`. It currently persists for the tab only.

### Methods are a flat namespace

`shotright.api.<method>` — not `shotright.api.vendor.*`. Register is
`register_vendor`, taking `first_name`/`last_name` separately (the register form
already collects both, so the earlier join into one `vendor_name` is gone).

### There is no "who am I" endpoint

`get_vendor_dashboard` is the cheapest authenticated call that returns the
profile, so it doubles as the session probe on reload.

---

## 2. Where the portal and the API disagree

These are the ones that matter. The portal **warns the partner on the success
screen** about each drop rather than failing silently — but a warning is not a
fix.

### 🔴 C1 — partner-authored moods cannot be saved

`create_venue` requires moods to already exist in the curated Mood list, and the
collection exposes no endpoint to create or suggest one.

The portal lets a partner type any mood (the C1 decision, and what the designs
show). Canonical matches are sent; anything new is **dropped with a warning**.
Sending it anyway is not an option — `create_venue` rejects unknown moods, which
would fail the entire submit.

**To close this**, the backend needs either:
- a `Mood Suggestion` doctype plus an endpoint to file one, and a Desk queue to
  merge them (this is what the C1 decision assumed), **or**
- an explicit reversal of C1, in which case the mood step should be changed to
  select-only and the designs revisited.

There is also **no endpoint that lists the curated moods**, even though
`create_venue` validates against it. Until one exists the typeahead reads
fixtures, so a partner can be shown a mood the backend will then reject.

### 🟠 C3 — operating hours: bridged, with one loss

The backend stores per-day rows; the wizard collects three ranges.
`expandOperatingHours()` in `src/services/vendor.js` converts: each selected day
takes the weekend range if it falls in the weekend, otherwise the weekday range,
with `weekendStartsFriday` moving that boundary.

**Public-holiday hours have nowhere to go** — the backend has no such concept.
They are dropped, with a warning.

### 🟠 C4 — menu item photos have nowhere to attach

`add_product_item` takes `item_name`, `price`, `description` — no image. The
upload succeeds (the File is created) but nothing links it to the item, so it
will never appear in the customer app. Dropped, with a warning.

### 🟡 Venue fields with no home

`create_venue` accepts `venue_name`, `latitude`, `longitude`, `dress_code`,
`atmosphere_desc`, `moods`, `operating_hours`. The wizard also collects **manager
name, manager surname, contact number, address and the rich-text description** —
none of which the endpoint takes. All dropped, with a warning.

Note also that the wizard collects an **address** while the API wants
**latitude/longitude**. Nothing geocodes between the two, so venues currently
submit without coordinates — which matters, because `find_venues` is a radius
search. **A venue with no coordinates will not be discoverable.**

### 🟡 No delete endpoint

`delete_product_item` has no counterpart in the collection, so item deletion is
mock-only.

---

## 3. Before flipping `VITE_USE_MOCKS=false`

- [ ] **Decide C1.** Either add mood suggestions, or reverse the decision and
      make the mood step select-only. Today a partner can type a mood, be told it
      saved, and find it silently absent.
- [ ] **Add a moods list endpoint**, so the typeahead stops guessing.
- [ ] **Resolve coordinates.** Either geocode the address server-side on
      `create_venue`, or add a map picker to the wizard. Without this new venues
      are invisible to radius search.
- [ ] Decide whether the dropped venue fields (manager, contact, description)
      should be added to `create_venue` — the designs collect them, so presumably
      yes.
- [ ] Confirm CORS on the bench, or rely on the Vercel proxy (below).
- [ ] Re-run the wizard end to end against the real bench.

## 4. CORS and the proxy

`vercel.json` proxies `/api`, `/files` and `/private` to
`shotright.thedaystar.co.za`, so the browser only ever sees its own origin and
**no CORS configuration is needed on the bench**.

With token auth the cookie argument for proxying has gone, so a direct
cross-origin call would now also work — provided the bench sets `allow_cors`.
The proxy is kept because it needs no bench change and keeps `VITE_API_BASE`
empty in every environment.

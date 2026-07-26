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

### 🟠 C1 — partner-authored moods: honest, but not yet possible

`create_venue` requires moods to already exist in the curated Mood list, and the
API exposes no endpoint to create or suggest one.

**Frontend behaviour has been changed to match.** An unmatched mood is now
refused *at the point of entry*, with the closest real alternatives offered and
the full list browsable. Previously it was accepted, and the partner only learned
four steps later — on the success screen — that it had been dropped. That was the
actual defect; a late warning is not much better than a silent one.

Alias resolution still works, so "boys night" → **Boys Night Out** as before.

**To restore the decided C1 behaviour**, `backend/mood_suggestions.py` is
drop-in ready: `get_moods`, `resolve_mood` and `approve_mood_suggestion`, plus
the `Mood Alias` and `Mood Suggestion` doctype definitions. The frontend already
supports the result — `MoodStep` still handles `status: "suggested"` and
`MoodPill` still has the outlined variant — so restoring it is deleting a branch,
not writing a feature.

Two things there matter more than the endpoints:
- **A Desk queue must call `approve_mood_suggestion`.** Without one, suggestions
  accumulate unseen and the venues attached to them never reach customer search.
- **`create_venue` should accept a suggestion in `moods`**, so a venue starts
  appearing the moment its suggestion is approved. Otherwise approving fixes the
  vocabulary but not the venues that asked for it.

`get_moods` is worth adding **even if C1 is reversed**: without it the portal's
list is fixtures, so it can offer a partner a mood the backend will then reject.

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

### ✅ Coordinates — closed

The wizard collects an **address** while the API wants **latitude/longitude**.
That gap is now closed at the point the address is entered. The Address field is
an autocomplete (`AddressAutocomplete.jsx`) backed by Nominatim: **picking a
suggestion sets the address and its coordinates in one action**, so the step a
partner was most likely to skip no longer exists as a separate step.

Two more routes remain for anything the geocoder does not know — common enough
for new developments and informal addresses — via `MapPicker.jsx`: click or drag
the pin, or type the numbers. The last is the accessible path; a map cannot be
operated from a keyboard, so those are real labelled inputs rather than a hidden
fallback. The autocomplete itself is a full ARIA combobox (arrow keys, Enter,
Escape, `aria-activedescendant`).

A partner can still clear the fields by hand, so `createVenue` warns when
coordinates are missing. Silence there would mean a venue that looks saved and
is permanently invisible to radius search.

**Runtime note:** tiles and geocoding come from `openstreetmap.org` and
`nominatim.openstreetmap.org`. No API key, but if a CSP is ever added to the
portal it must allow those hosts or the map and suggestions die while the rest
of the page looks healthy. Nominatim's usage policy asks for at most one request
per second — the autocomplete debounces at 500ms and aborts in-flight requests,
so do not lower that or fire per keystroke. A geocoder outage is handled: the
field falls back to plain text and tells the partner to drop the pin instead.

### 🟡 No delete endpoint

`delete_product_item` has no counterpart in the collection, so item deletion is
mock-only.

---

## 3. Before flipping `VITE_USE_MOCKS=false`

- [ ] **Decide C1.** Either add mood suggestions, or reverse the decision and
      make the mood step select-only. Today a partner can type a mood, be told it
      saved, and find it silently absent.
- [ ] **Add a moods list endpoint**, so the typeahead stops guessing.
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

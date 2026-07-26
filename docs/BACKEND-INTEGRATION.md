# Backend integration — status and gaps

**The backend exists and the deployed portal now uses it.** The `shotright`
Frappe app is deployed at **`shotright.thedaystar.co.za`** (not `bloop`, which
earlier notes referenced). This document records what is connected, what is not,
and what still needs backend work.

Source of truth: the Sho't Right API Postman collection.

---

## 0. Fixtures are dev-only (changed)

Until this change, `VITE_USE_MOCKS` defaulted to **on** and applied in every
environment. The Vercel deployment carried `VITE_USE_MOCKS=true`, so partners
opening the live portal saw the invented venues in `src/services/mockBackend.js`
— "The Rooftop, Braamfontein", "Kota King, Soweto" — as though they were their
own listings. The demo-mode banner that had been the only signal was removed
shortly before, on the reasonable assumption that the portal was live.

The flag is now:

```js
USE_MOCKS = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true'
```

Two changes, both deliberate:

- **Gated on `DEV`.** No deployed build can select fixtures whatever the hosting
  dashboard says. The env var in Vercel is now inert; it does not need removing,
  though removing it is tidier.
- **Default inverted.** It was "mocks unless explicitly off", so a missing or
  misspelt variable silently produced fake data. It is now "real unless
  explicitly on", so the failure mode of a missing variable is a visible
  connection error rather than a convincing lie.

`mockBackend.js` also throws if it is ever called in a production build, so a
future rewiring mistake fails loudly instead of quietly returning fiction.

To work offline: `VITE_USE_MOCKS=true npm run dev`.

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

**Mood matching now runs against whatever list is live.** It used to match
against fourteen hard-coded fixtures even with the real backend connected — so
the portal could accept a mood the bench has never heard of, and `create_venue`
would then reject the entire submission. `matchMood()` in `src/services/moods.js`
is now a pure function of (list, text), and `getMoods()` reads the real Mood
doctype through Frappe's generic resource API:

```
GET /api/resource/Mood?fields=["name","mood_name"]&limit_page_length=0
```

**This needs read permission on `Mood` for the Vendor role.** If the read fails
— no permission, doctype named differently, bench down — the portal falls back
to `FALLBACK_MOODS` in `moods.js` so the wizard keeps working, and warns to the
console. That fallback is a guess about the bench's vocabulary, which is why
`get_moods` is still worth adding **even if C1 is reversed**.

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

`delete_product_item` has no counterpart in the collection. Deletion used to
call the fixture unconditionally, which against the real bench meant the row
vanished from the screen, the partner believed it was gone, and it was still on
their menu in the customer app after a refresh — a silent no-op dressed as a
success. It now calls `frappe.client.delete` on `Product Item`, which works if
the Vendor role has delete permission and returns a real permission error if
not. **Confirm the doctype name and the role permission**; the error path is
honest either way, but a working delete is better than an honest failure.

### 🟡 Dress codes and atmospheres are portal-side

No lookup endpoint and no doctype to read generically — `atmosphere_desc` is
free text on the bench, not a select. The lists live in `src/services/lookups.js`
and are served in every environment. They are vocabulary, not partner data, so a
local list misrepresents nothing; a Desk-managed list would still be better, so
staff can extend it without a portal release.

---

## 3. Still needed from the backend

The portal is on the real bench now, so these are no longer blockers to cutover
— they are live gaps that partners can hit.

- [ ] **Decide C1.** Either add mood suggestions, or accept that the mood step is
      effectively select-only. Today an unmatched mood is refused at entry, which
      is honest but means a partner whose vibe is not on the list has no route in
      beyond asking staff.
- [ ] **Add `get_moods`**, or grant the Vendor role read on `Mood` so the
      resource-API path works. Without either, the typeahead is guessing from
      `FALLBACK_MOODS`.
- [ ] Decide whether the dropped venue fields (manager, contact, description)
      should be added to `create_venue` — the designs collect them, so presumably
      yes.
- [ ] Confirm the `Product Item` doctype name and delete permission.
- [ ] Re-run the wizard end to end against the real bench, with a real partner
      account. **This has not been done from CI** — the build environment has no
      outbound route to `shotright.thedaystar.co.za`, so the integration was
      verified against a stubbed bench, not the live one.

## 4. CORS and the proxy

`vercel.json` proxies `/api`, `/files` and `/private` to
`shotright.thedaystar.co.za`, so the browser only ever sees its own origin and
**no CORS configuration is needed on the bench**.

With token auth the cookie argument for proxying has gone, so a direct
cross-origin call would now also work — provided the bench sets `allow_cors`.
The proxy is kept because it needs no bench change and keeps `VITE_API_BASE`
empty in every environment.

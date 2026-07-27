# Smart defaults — implementation notes

Implements the handoff spec of 27 July 2026 for "Enter your venue's details".
This records only where the build **deviates from** or **cannot yet satisfy**
the spec, and why. Everything not listed here is implemented as written.

Code: `src/services/smartDefaults.js` (matrix and tiers),
`src/hooks/useSmartDefaults.js` (state), `src/hooks/useDeviceLocation.js`
(signal), `src/components/ui/DefaultChip.jsx` (§7),
`backend/venue_option_popularity.py` (the popularity endpoint).

---

## 1. Two signals the bench cannot supply

Both are handled by **not defaulting**, which is what the spec asks for in each
case. Neither is approximated.

### `session.user.phoneVerified` does not exist

There is no verification flag anywhere in the API. §9 is unambiguous —
"Applying it would launder an unverified value into a customer-facing field
through a UI that implies we checked it" — so **the contact-number default is
dormant.** Everything around it is built and tested: supply a truthy
`phone_verified` on the profile and Tier B lights up, formats to national
grouping, and gates Continue.

`isPhoneVerified()` in `smartDefaults.js` is the single place to change.
**Do not** relax it to `Boolean(profile.phone)` to make the feature demo
better — that is exactly the laundering §9 forbids.

### Aggregate popularity has no endpoint

`backend/venue_option_popularity.py` is drop-in ready. Until it is deployed the
dropdowns render with no default and no chip, which §9 already names as
acceptable.

**The 62% / 48% figures in the spec table are treated as illustrative.** They
are never hard-coded. A share is displayed to the partner *as justification*,
so shipping an invented one would put a fabricated statistic in front of them —
and would seed the exact feedback loop §12 warns about with a number nobody
measured.

The endpoint carries three guards against that loop, none decorative:
approved venues only, a 25-venue floor below which it returns nothing, and an
85% ceiling above which it also returns nothing — deliberately switching the
default **off** for a dominant option so the distribution can re-spread. That
last one reads like a bug and is not; it is commented as such in the file.

---

## 2. Three visual tokens not adopted

Measured, not preferred. The other tokens are used exactly as specified — the
three chip palettes clear 4.5:1 (4.95, 5.51, 4.85) and are unchanged.

| Token | Spec | Measured | Used instead |
|---|---|---|---|
| `color-prefill-border` | `#d9b23a` | **2.02:1** on white | `--color-brand-edge` `#b28020` — 3.50 / 3.43 / 3.27 on white / prefill / canvas |
| `color-accent` (focus ring) | `#f5b301` | **1.85:1** on white | existing brand-edge focus treatment, 3.50:1 |
| `control-height` | `64px` | — | existing control height |

The border is what identifies the field's state, so WCAG 1.4.11 wants 3:1. It
also fails the spec's **own first principle**: a default must be VISIBLE, and a
2:1 border is not. `#b28020` is the same hue family and already in the system.

`control-height: 64px` is not applied because these controls are shared with
every other form in the portal. Applying it here alone would fork this step
visually from the rest; applying it globally is a portal-wide redesign, not a
smart-defaults change. Flagging rather than deciding — say the word and it
becomes a one-line token change.

---

## 3. Rules that are blocked, not skipped

### Second-venue defaults (§9)

> "Contact number and manager details should default from the existing venue
> rather than the raw profile where the two differ."

**Cannot be implemented.** `create_venue` does not store manager name, surname
or contact number at all, so there is no previous venue to read them from. They
default from the profile instead.

The dangerous half of that rule **is** implemented: address and pin never carry
over, and the venue name is always empty. The provisional pin is guarded on the
coordinates being empty at the moment of application, so nothing can copy a
previous venue's location.

### The same gap undercuts the payoff

Manager name, surname and contact number are dropped by `create_venue` (see
`docs/BACKEND-INTEGRATION.md`). Defaulting them genuinely saves typing — and
the values still do not reach the database. Worth closing before measuring
acceptance rates, or three of the six defaults will look effective while
changing nothing downstream.

### Measurement (§12) has events but no destination

All four events are emitted (`default_applied`, `default_accepted`,
`default_edited`, `default_dismissed`, plus `default_confirmed` and
`default_suppressed_for_account`). There is **no analytics provider in this
portal**, so `analytics.js` re-emits them as a `shotright:analytics` DOM event
and nothing records them.

Until a listener exists, the 70%-acceptance health metric and the A/B in §12
**cannot be read**. Adding a provider is one listener in one file; no call sites
change.

The rollout flag is implemented — `VITE_SMART_DEFAULTS` is `on` (default),
`off`, or `50`, bucketing deterministically on the account email so a partner
does not flip arms between sessions.

### Dismissal suppression is per-device

§6's "a note is written to the account record" has no endpoint. The
three-strikes counter lives in `localStorage`, so it is per-device rather than
per-account. When an endpoint exists this becomes a cache in front of it.

---

## 4. One addition beyond the spec

**A provisional pin blocks Continue.** The spec assigns the map pin to Tier B
but only names the contact number in the §8 blocked-Continue row. A pin left at
the device's location is the worst outcome available on this form — the venue
saves, looks fine, and is invisible to the radius search that is the entire
product — so it is gated too, with copy naming the pin specifically. It clears
the moment the pin is dragged, typed, or set from a chosen address.

---

## 5. Verified

33 checks against a production build (`verify6`), covering both backend states
for popularity, verified and unverified phone, granted and denied geolocation,
dirty flags surviving step navigation, the layout-shift guarantee on chip
dismissal, and that no percentage appears anywhere when the endpoint is absent.

**Not verified against the live bench** — no outbound route from the build
environment to `shotright.thedaystar.co.za`.

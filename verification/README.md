# Verification suites

Nineteen Playwright scripts, ~370 checks, one per feature as it was built. They
are the evidence behind the claims in `docs/DEV-LOG.md`.

These are **not** unit tests. Each one drives a **production build** in a real
browser with the Frappe bench stubbed at the network layer, and asserts on what
a partner would actually see — including what the screen says when an endpoint
is missing, which is the state most of this portal is in today.

## Running them

```bash
npm run build
npx vite preview --port 4173 --host 127.0.0.1 &
node verification/verify12.mjs
```

They expect Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(the path in the environment they were written in). Change the
`executablePath` at the top of a file, or drop it entirely to use whatever
`playwright` resolves.

Run them one at a time — several drive the full five-step wizard and take
30–60 seconds each.

## What each one covers

| File | Covers |
|---|---|
| `verify.mjs` – `verify4.mjs` | auth, dashboard, venue list and tabs, the wizard end to end, accessibility |
| `verify5.mjs` – `verify7.mjs` | address autocomplete, map picker, operating hours, mood suggestions |
| `verify8.mjs` | smart defaults — tiers, dirty flags, the Tier B confirmation gate |
| `verify9.mjs` | autosave and resume; the four-stage menu-import checklist against a 2,001-row file |
| `verify10.mjs` | the menu 404 — missing endpoint vs missing venue vs happy path |
| `verify11.mjs` | venue photos — upload, downscale, reorder, cover, HEIC, draft, submit |
| `verify12.mjs` | the declined-venue review screen |
| `verify12b.mjs` | the same screen built **with** `VITE_SUPPORT_EMAIL` set |
| `verify13.mjs` | editing a venue — the rename identifier bug, and a rename that silently did nothing |
| `verify14.mjs` | the two-promise split on menu import (mail on vs off), and the phone field |
| `verify15.mjs` | where the decline reason comes from — endpoint vs venue record vs dashboard row |
| `verify16.mjs` | the live "See why" 404: `get_venue_detail` failing on a venue the dashboard just listed |
| `verify17.mjs` | the corrected read name `get_review_fix_items`, and `contact_support` refusing to claim an unconfirmed send |
| `verify18.mjs` | the pending screen — derived sections, and the four things it refuses to say |
| `verify19.mjs` | `update_venue` refusing fields instead of ignoring them, and the strip-and-retry |

`verify12b.mjs` needs its own build:

```bash
VITE_SUPPORT_EMAIL=help@shotright.example npm run build
```

The address matters — `verify12b` asserts on the exact `mailto:` it produces.

## Why they are shaped like this

Most of the assertions are about **copy**, and that is deliberate. Nearly every
bug worth catching on this project has been a sentence that was not true —
fixtures presented as a partner's real venues, `DoesNotExistError` shown to a
restaurant owner, a Declined tab that was empty because one string was wrong, a
"saved" that saved nothing. A test that only checks a component renders would
have passed through all of them.

So the suites assert things like *"no generic placeholder reason appears
anywhere"* and *"the in-browser parse does NOT promise to email you"*. Those
read oddly as tests. They are the actual requirement.

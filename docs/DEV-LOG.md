# Dev log — Sho't Right Partner Portal

One entry per working session: what was built, what was decided and why, what
broke, and what is still owed to somebody.

**Why keep this.** The commit messages carry the *what*. This carries the
things a diff cannot: which decisions were made under uncertainty, which are
waiting on an answer from someone, and which bugs came from the same root cause
for the fourth time. Anyone picking this up — including me, next session —
should be able to read the last entry and know exactly where the edges are.

> Entries before **27 Jul 2026** are reconstructed from the commit history and
> the docs written at the time. They are accurate about what shipped; they are
> less complete about what was discussed and rejected than the later ones.

Session ID for all of this work: `session_01KxKyuWPd63AtzWiGo91Pr3`.

---

## 27 Jul 2026 (late) — a rename that never happened, and a photo backend going live

**Reported:** *"when editing a venue the name does not persist."*

**Half of it was ours.** `updateVenue` sent
`{ venue_name: venueId, ...payload }`. `venue_name` is the **identifier** on
every endpoint in this API — `get_venue_detail` is called with the docname under
exactly that key — but `payload` comes off the edit form carrying the partner's
**new** name under the same key, and it spread second. Every rename said "update
the venue called *the name that doesn't exist yet*" and never mentioned the
venue being edited. One key doing two jobs, colliding at precisely the moment
the two values differ.

**Fixed**

- The identifier is built separately and assigned last, so nothing can reach it.
  A new name travels under `new_name` (what `frappe.rename_doc` calls it) and
  `new_venue_name`; Frappe drops the one it doesn't declare.
- Only an explicit list of writable fields is sent. The form was spreading the
  whole loaded venue — including **`workflow_state`**, a client setting its own
  approval state, which the create path is careful never to do.
- **The write is verified.** The venue is re-read and the name compared. If it
  didn't change the page stays put and says so, with the field reset to what the
  server actually holds. Navigating on after a partial save is how a silent
  failure becomes a belief.

**A defect in my own fix, caught by the test.** The first version compared the
typed name against `venueId`. A Venue's docname may be `VEN-0001` while its
`venue_name` is "Corner Kitchen & Bar", so *every* ordinary save — a dress code,
a map pin — looked like a rename and came back warning that the name hadn't
saved. A false alarm on every edit is worse than the bug it guards against,
because people learn to click through warnings. `useUpdateVenue` now takes the
server's current name alongside the id.

**Still theirs:** is `update_venue` even deployed, what does it take a new name
under, and is `Venue` autonamed from `venue_name` (in which case a rename needs
`frappe.rename_doc`, whatever the parameter is called). Ask **§1b**.

---

**Also: the photo backend was reported ready.**

Nothing here assumes it landed — the probe decides per tab, and unconfirmed
names fall back to the pre-deployment behaviour. But going live opened a failure
that `withFallback` alone cannot see: **the endpoint existing and the endpoint
understanding us are different things.** A `photos` argument spelt differently
server-side is dropped by Frappe at HTTP 200 — and by then the probe has already
told the uploader it's safe to promise these reach customers. The partner would
be told their gallery is live over an empty child table, which is worse than the
missing endpoint we started with, because nobody is looking for it.

So `saveVenuePhotos` now **reads the gallery back after writing it** and reports
a short count instead of claiming a save. One extra request on a rare action.
The read-back is only trusted when the real read endpoint answered — the
attachment fallback legitimately returns zero for photos uploaded before the
venue existed, and treating that as a mismatch would raise an alarm about a save
that was fine.

**Verified** — `verify13.mjs` (22 checks) for the rename; `verify11.mjs` gained
a deployed-but-deaf case. All fourteen suites green.

---

## 27 Jul 2026 (afternoon) — declined venues get an explanation

**Shipped**

- **The declined-venue review screen** (`/venues/:id/review`), reachable from
  both the dashboard and the Declined tab. The reviewer's note, verbatim and
  attributed; their fix-item checklist; gaps we derive ourselves; edit-and-
  resubmit and contact-support.
- `backend/venue_review.py` — drop-in for `get_venue_review` and
  `set_review_fix_item`, plus the four `Venue` fields and the `Venue Fix Item`
  child table.
- `Button` gained `as`, so a mailto action can be a real anchor instead of a
  `<button>` illegally nested inside one.

**Decisions**

- **No placeholder decline reason.** The bench has no field for a moderator to
  write into, so every decline currently arrives blank. The screen says "no
  reason was recorded" rather than "your venue didn't meet our guidelines". A
  generic line is worse than an admitted absence: the partner acts on it,
  changes the wrong thing, resubmits, and is declined again — and now they have
  also learned our explanations aren't worth reading.
- **Derived gaps are a separate section with their own disclaimer.** We can see
  no map pin, no moods, no photos, empty menu, no description without being
  told, and those are the common decline reasons. But a partner who fixes our
  five observations when the reviewer declined them over something else has
  been sent on an errand by their own software. Separate heading, explicit "these
  aren't the reviewer's reasons".
- **With no reason given, "Contact support" leads and "Edit and resubmit"
  follows.** Same two buttons, weighted to whichever is actually the better move.
  Editing with nothing to act on is an invitation to guess.
- **Ticking a fix item is the partner's own note, not a report to the reviewer,
  and the copy says so.** A checkbox that looks like it tells someone you fixed
  something, and doesn't, leaves a partner waiting for a reply that isn't coming.
- **No invented support address.** `VITE_SUPPORT_EMAIL` is deliberately
  undefaulted. Unset → no button, and the screen says plainly there's no address
  wired in. A guessed address doesn't bounce loudly; it just never gets read.

**Owed to us**

- `review_notes`, `reviewed_by`, `reviewed_on`, `fix_items` on `Venue`, and
  `review_notes` made **required on the decline transition** — a workflow that
  permits an empty note will produce them.
- The support address. Better still, a `contact_support(venue_name, message)`
  endpoint so a question lands attached to the venue rather than in a shared
  inbox with no context.
- **Decision needed:** does resubmitting edit the Venue or restore a Draft? The
  shipped button edits the Venue. If it should be a draft, `save_venue_draft`
  needs a `venue` link field and the button changes.

**Verified** — `verify12.mjs` (30 checks) and `verify12b.mjs` (7, built with a
support address configured). `verify1`–`verify11` re-run green.

---

## 27 Jul 2026 (midday) — venue photos

**Shipped**

- `PhotoUploader`, in the wizard's details step and on an existing venue:
  multi-select and drag, reorder, cover photo, remove.
- Browser-side downscaling (`src/utils/image.js`). A 7.5 MB photo goes up as
  1.3 MB.
- `backend/venue_photos.py`; §14 of `BACKEND-ASKS.md`.
- A console snippet in `BACKEND-ASKS.md` that prints which `shotright.api.*`
  methods actually exist, since this environment can't reach the bench.

**Decisions**

- **Downscale rather than reject.** A current handset writes 3–6 MB per photo.
  `accept="image/*"` plus a 5 MB cap rejects a large share of real photos with
  a message the partner can do nothing about.
- **Decode through an `<img>`, not `createImageBitmap`.** Browsers apply EXIF
  orientation when an `<img>` is drawn to a canvas and do not for an
  ImageBitmap without `imageOrientation: 'from-image'`, which older Safari
  ignores. Otherwise every portrait phone photo arrives on its side.
- **Upload immediately, link on create.** The wizard has no venue yet. Uploading
  as chosen is what lets the partner see the photo, and what lets a resumed
  draft come back with its pictures — a draft can carry a `file_url`, never a
  `File` object.
- **Tell them before they arrange, not after they submit.** Eight photographs in
  a deliberate order is real work. `venuePhotosSupported()` is a bespoke probe
  rather than `withFallback`, because the latter caches a missing *venue* as a
  missing *method*.
- Order is data: photo 1 is the search-result card image.

**Bugs found while building**

- Three files dropped at once each wrote back a photo list captured before any
  of them landed — two of three silently lost. Fixed with a ref updated on
  render *and* immediately after each append.

**Verified** — `verify11.mjs` (37 checks), including the downscale asserted from
the uploaded JPEG's own SOF marker rather than from byte count alone.

**Merged** — PR #1, `467bd2f`.

---

## 27 Jul 2026 (morning) — waiting states, resumable setup, an honest 404

**Shipped**

- **Menu import waiting states.** Four real stages — uploaded, found N
  categories, reading N items and prices, checking for missing prices — from the
  background job's `stage` field and from the wizard's in-browser parse through
  one shared vocabulary.
- **Resumable setup.** Autosave within and across steps; a dashboard card back
  into the exact step. `localStorage` today; `backend/venue_drafts.py` and
  `docs/RESUME-SETUP.md` for the real thing.
- **The reported menu 404**, made honest.

**Decisions**

- **Counts only once counted.** "62%" says time is passing; "found 4 categories,
  reading 38 items" says we opened the file and understood it.
- **The parse loop yields every 250 rows**, so a large file reports a measured
  "1,500 of 4,000" instead of an animation.
- **"You don't have to wait, we'll email you" only where a job is genuinely
  queued server-side.** The wizard parses in the tab and doesn't make the offer.
- **The escape hatch to manual entry is offered from the first second**, not
  after 45.
- **Conditional promises.** A server draft says "nothing expires — and we
  emailed you this link too"; a browser-local one says where it actually lives.

**Bugs found**

- **A restaurant owner was being shown the string `DoesNotExistError`.** Frappe
  returns the same 404 for a missing *method* and a missing *document*.
  `isMethodMissing()` separates them from the raw exception text; a missing
  endpoint now names itself, a missing venue is said in plain words.
- **Resume restored the step but not the data.** Patching a draft in from an
  effect raced smart defaults, which write into the same object from a pre-patch
  snapshot — the restored venue name was wiped a tick after it appeared. There is
  no safe ordering of those two effects. Drafts became initial state, not an
  effect, with `key={resumeId}` on an inner component.

**Owed to us** — the five menu method names. `get_venue_products` is 404ing in
production and this environment cannot reach the bench to confirm the right one.

---

## 27 Jul 2026 (early) — smart defaults, validation, workflow states

- Smart defaults on the venue details step: tiers, dirty flags, chips, a Tier B
  confirmation gate, and instrumentation (`docs/SMART-DEFAULTS.md`).
- Validation moved from submit-time to per-field-on-blur and per-step-on-Next.
  Being told on screen five that screen two needs a name is the slowest possible
  way through a form.
- **`6966a59` — the third bug from the same root cause.** The portal filtered
  declined venues on the literal `'Rejected'`, a string invented in
  `backend/api_reference.py` before the real API existed. A venue declined in the
  Desk vanished from the partner's Declined tab with no error anywhere. Now
  matched by *family*, with unrecognised states surfaced under All rather than
  dropped.

---

## 26 Jul 2026 — build-out

Portal scaffolded and built end to end: auth, dashboard, venue list, the
five-step wizard (moods, details, hours, menu, review), menu management, profile.
Wired to the live bench. Map picker and geocoded address autocomplete so venues
submit with coordinates. Accessibility pass — nine WCAG contrast failures and
several keyboard gaps. Mobile navigation moved into a drawer.

**The two bugs that set the tone for everything after**

- **Fixtures were being served in production.** The Vercel deployment carried
  `VITE_USE_MOCKS=true`, so partners were shown invented venues out of
  `mockBackend.js` as though they were their own listings. `USE_MOCKS` is now
  gated on `import.meta.env.DEV`, so no deployed build can take that path
  whatever a hosting dashboard says, and the default inverted from "mocks unless
  disabled" to "real unless explicitly enabled, in dev only".
- **`vendor_name` does not exist on the bench.** Another string from
  `api_reference.py`. The profile page showed a blank name.

---

## The through-line

Four bugs, one cause: **string literals invented in
`backend/api_reference.py` before the real API existed** — `vendor_name`,
`Rejected`, and five menu method names.

The response is not a better guess. It is to make the mismatch visible and
survivable: alias families, capability detection, post-write verification, and
diagnostics that name the offending value so the person who can answer it gets
told what to answer.

And the rule that falls out of it: **never print a promise the code behind it
cannot keep.** "You don't have to wait, we'll email you", "nothing expires, we
emailed you this link", "your photos are live", "here's why you were declined" —
each of these appears only once the thing that would make it true exists.

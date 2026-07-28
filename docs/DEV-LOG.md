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

## 28 Jul 2026 (latest) — asking for what we already had

Two corrections today, both in the same direction, and the direction is the
lesson: **check what you are already holding before you ask whether you may
fetch it.**

### 1. The decline reason was on the wire the whole time

I wrote §12 of BACKEND-ASKS asking the backend to add `review_notes`,
`reviewed_by` and `reviewed_on` to `Venue`, to stamp the date on the transition
rather than on save, and to confirm the workflow state names.

All four already existed. `venue.json:81-94` has the fields.
`vendor_dashboard.py:27` has been returning them to this portal all along — put
there deliberately so a declined venue could render its reasons without a second
round trip. `venue.py:31-54` (`_stamp_review`) already only writes when
`workflow_state` actually changes. The states are **Pending / Approved /
Declined** on the **Venue Approval** workflow, `is_active=1`, and all three were
already in `workflowState.js`'s alias lists.

Meanwhile the decline screen was calling `get_venue_review` — not deployed —
catching the 404, and rendering **"No reason was recorded"** to every declined
partner. Printed on top of a reason we had been handed and hadn't looked at.

Nothing errored. The capability detection was correct: the endpoint really is
missing. It was just answering a question that didn't need asking, and the
answer got reported as a fact about the partner's data rather than about our own
plumbing. **A missing ENDPOINT was shown to a business owner as missing DATA.**

Fixed: `getVenueReview(venueId, venue)` now reads in order — the endpoint if it
ever ships (only source of `fix_items`), then **the venue record already in
hand**, then the dashboard row. First source carrying the field wins. Nothing
needs deploying.

Three details worth keeping:

- `available` no longer means "an endpoint answered", it means "we could read
  the fields". Those came apart the moment the data turned out to ride along on
  the venue. `source` names which of the three paths produced the screen.
- The presence test is `'review_notes' in raw`, **not** truthiness. A field
  present and empty is a moderator who wrote nothing — a process gap. A field
  absent is our plumbing. They look identical to the partner and must not read
  identically to us, and Frappe sends an empty Small Text as `""` or `null`.
- `reviewed_on` no longer falls back to `modified`. `modified` moves whenever
  anyone touches the row, so a moderator opening the doc in October would make a
  July decline read as "· 12 October". A missing date beats a wrong one.

### 2. "See why" was 404ing on production

Reported from the live site mid-session, signed in as a real partner:

```
GET …get_venue_review?venue_name=VEN-00002  417 (Expectation Failed)
GET …get_venue_detail?venue_name=VEN-00002  404 (Not Found)
→ "We couldn't open this venue. It isn't on the account you're signed in with,
   or it has been removed."
```

Both halves of that sentence were false. The venue was on their account and had
not been removed — `get_vendor_dashboard` had just listed it, which is how they
got a "See why" link to click. One endpoint refused to repeat what another had
already told us, and the portal turned that into a message about their
livelihood having disappeared.

`getVenue` now falls back to the dashboard row on any non-403 failure, marking
the result `_partial`. **403 still throws** — "this venue is not yours" is a real
answer, and the fallback must not become a way of never admitting anything is
wrong. A venue genuinely in neither place still errors too.

The error copy also split `isMethodMissing` out of the 404 branch. Frappe
returns the same 404 for a missing method and a missing document, and guessing
"your venue is gone" when the truth is "that endpoint isn't deployed" is the
most alarming possible way to report our own gap.

The 417 is its own finding: `get_venue_review` is **deployed and throwing**, not
absent. `withFallback` rethrows non-404s by design, so that is a hard error — it
just isn't the partner's problem, and no longer reaches them. Filed as §0.

### 3. A third place the email promise was loose

While looking at the pending state, found `VenueReview.jsx` telling partners
*"We'll email you the moment there's a decision"* — the same untrue sentence
fixed yesterday in the menu importer, in a second component nobody thought to
check. §8 is not shipped; no mail goes out for venue decisions either. Replaced
with what is true: the decision appears on that page.

Yesterday's lesson was *one capability flag per claim*. Today's addition:
**when you find a promise you can't keep, grep for the promise, not the flag.**
The same sentence had been written twice, independently, in two components that
share no code.

### Still open after all that

`fix_items` / `Venue Fix Item` is the only part of the decline screen with
nothing behind it — the checklist card never renders. Least urgent thing there.

The **required note on the decline transition** got *more* important, because of
an interaction with the backend's own stamping. `_stamp_review()` clears
`reviewed_by`/`reviewed_on` on resubmit but keeps `review_notes`. So a venue
declined with a note, edited, resubmitted, and declined again by a moderator who
writes nothing will show the **old note restamped with today's date**. A stale
reason presented as fresh is worse than no reason: they already fixed that, so
they conclude the fix didn't count. The portal cannot detect it — a kept note and
a new note are byte-identical to us. Only a required note closes it.

Also asked (§15): we tell a waiting partner **nothing** about how long approval
takes. No submitted date, no turnaround, no way to tell this morning's
submission from one three weeks old. We are not inventing a number — a turnaround
figure is a commitment the business makes, not a string the frontend picks. The
cheap half is a `submitted_on` stamped on the transition into Pending, which
lets us say "Submitted 24 July" and "with our team for 3 working days" without
anyone promising anything.

### 4. The sixth name mismatch — and it explains the 417

Backend traced it while this was being written:

```
AttributeError: module 'shotright.api' has no attribute 'get_venue_review'
hasattr(get_review_fix_items | set_review_fix_item | contact_support) → True
```

The read endpoint was built as **`get_review_fix_items`**. Attribute resolution
fails before any handler runs — which is exactly why we saw **417 and not 404**,
and why I read it as "deployed and throwing" rather than "not there". Our
capability detection keys on 404, so a missing *attribute* and a missing
*whitelist* land on opposite sides of the same test. That's now flagged to them
as the generalisable bit; the specific fix is the usual one, a list of names
tried in order. Sixth time on this project.

Consequence worth having: **the fix-item checklist renders for the first time.**
It had never appeared, because it was reading from an endpoint that didn't
exist. The note and the checklist now come from different places — notes off the
venue record, items off `get_review_fix_items` — and either can be absent.

### 5. "Contact support" reaches somebody now

`contact_support` is live. The button had been **hidden entirely** whenever
`VITE_SUPPORT_EMAIL` was unset, which it always was — so the primary action on
the one screen where a partner most needs a human was simply not on the page.
That was the right call when a mailto to a guessed address was the only route.
It isn't now.

The care went into **not claiming delivery**. Frappe drops undeclared kwargs at
HTTP 200, and I don't know this endpoint's parameter names. For a profile field
that costs a value; here it would cost a business owner believing they had asked
for help and waiting for a reply nobody can send — the worst version of this
failure on the project. So the message goes under several plausible names at
once, and "Sent" appears only if the response carries a `name`/`reference`/`id`
or an explicit `ok`. A bare `null` gets *"we couldn't confirm that went
through"*, their text stays in the box, and the mailto sits beside it.

Asked them to return the docname on success, since otherwise every partner who
contacts support gets the unconfirmed wording.

Three assertions in `verify12.mjs` encoded the old rule — no address means no
button. Updated, not deleted: the replacement is where the requirement went. The
rule underneath it hasn't changed, it just moved to where it can now be answered
honestly, at the point of sending.

One small regression caught by that update: the venue reference had only ever
been printed inside the "we have no support address" notice, so removing the
notice took it with it. It's back on its own, always visible — it's what a
partner quotes on WhatsApp or a phone call, which is how most of them will
actually reach us.

Verification: `verify15.mjs` (18 checks, where the reason comes from),
`verify16.mjs` (13 checks, the live 404 reproduced), `verify17.mjs` (17 checks,
the corrected name and the unconfirmed send). All seventeen suites green.

---

## 27 Jul 2026 — the backend shipped, and one promise came loose

Backend reported: **all P0, plus P1 §5, §6, §7, §9, §14 deployed and verified,
180 tests passing.** Next up their end is outgoing mail, so §8's OTP endpoints
can ship.

Most of that needs nothing from us — every P1 feature is capability-detected and
turns itself on. Two things did need attention.

### The email promise came loose

**§6 (background menu import) went live while §8 (mail) did not.** The portal
keyed its whole "you can leave" panel off one flag, `canLeave`, set the moment
the import became a server job. So the instant §6 landed, every partner
uploading a menu was told:

> *You don't have to wait — leave this page and we'll email you the moment your
> menu is ready.*

No email was going to arrive. This is precisely the failure the project is
disciplined against, arriving through the back door of somebody else's
deployment.

**They are two promises, and they now need two permissions.** `canLeave` says
the work outlives the page — true, and useful on its own. `willEmail` says a
message is actually coming, and comes from `will_notify` on the import status,
defaulting to **false**. Without it the partner gets the honest, smaller version:
*"leave this page and come back whenever you like. It keeps going without you,
and this panel picks up where it left off."* Configuring the mailer turns the
bigger sentence on with no frontend release.

The general lesson, which is new: **a capability flag that gates two claims will
eventually gate them wrongly**, because the things they depend on ship
separately. One flag per claim.

### The phone field is a control again

§2 landed, so `update_vendor_profile` should now take `phone`. Settings had it
read-only — a control that accepts input and discards it is worse than one that
explains itself.

We still can't confirm the parameter name from here. What made it safe to ship
anyway is machinery that already existed for the name fields: the profile is
re-read after the write and compared, so a differently-named parameter surfaces
as *"saved, but your phone number didn't stick"* rather than as a lie. The guard
written for one bug paid for the next feature.

**Verified** — `verify14.mjs` (14 checks), including both sides of the mail
window and a deliberately deaf `phone` parameter.

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

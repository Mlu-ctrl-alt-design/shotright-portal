# Sho't Right Partner Portal — what we need from the backend

One page, ordered by what is hurting partners right now. Everything below is
either **blocking a live user**, **blocking a shipped feature**, or **a question
only you can answer**.

Reference implementations exist for most of it — the files named are drop-ins for
`shotright/api.py`, not designs to review. If you disagree with one, the only
things that are load-bearing are **the method names, the parameter names, and the
return shapes**.

---

## ⚠️ Read this first: Frappe drops undeclared kwargs silently

`frappe.call()` filters kwargs down to the declared signature. An argument the
method does not declare is **discarded at HTTP 200, with no error**.

Three separate production bugs on this project came from exactly that. If a
parameter below is renamed or omitted server-side, the portal will appear to work
and will save nothing, and nobody finds out until a partner loses their work.

**Keep the names exactly as written, or tell us what they actually are.**

---

## P0 — a partner is hitting this now

### 1. The menu endpoints 404

Opening a venue's menu returns "Not found". These five method names predate the
real API and have never been confirmed against the Postman collection:

| Portal calls | Purpose | Status |
|---|---|---|
| `shotright.api.get_venue_products(venue_name)` | read a venue's menu | 🔴 **404 in production** |
| `shotright.api.add_product_heading(venue_name, heading_name)` | create a heading | ❓ unverified |
| `shotright.api.add_product_item(heading_name, item_name, price, description)` | create an item | ❓ unverified |
| `shotright.api.bulk_import_products(venue_name, rows)` | bulk rows | ❓ unverified |
| `shotright.api.import_products_from_excel(venue_name, file_name)` | file upload | ❓ unverified |

**What we need: the correct names and parameters.** It is a one-line change per
call at our end. We could not probe the bench ourselves — the build environment
has no outbound route to `shotright.thedaystar.co.za`.

Also outstanding: **there is no delete for a menu item.** The portal currently
falls back to `frappe.client.delete` on `Product Item`, which needs the Vendor
role to have delete permission on that doctype. Please confirm the doctype name
and either grant it or add `delete_product_item(item_id)`.

### 2. `update_vendor_profile` has no `phone`

Signature confirmed as
`update_vendor_profile(first_name, last_name, business_name, new_password)`.

The venue wizard collects a contact number and the profile page displays one, but
there is no parameter to save it — so the Settings phone field is **read-only**.
Please add `phone`.

### 3. What does `get_vendor_dashboard` put in `profile`?

The *update* signature is confirmed; the *read* payload is inferred from it. The
portal currently tolerates `vendor_name` / `full_name` / `first_name + last_name`
because it does not know which it gets. One sentence from you deletes that
guesswork.

### 4. What are the Venue workflow's real state names?

The portal matches states by **family** — `declined | rejected | denied | not
approved | …` — because the first version matched the single literal `Rejected`
and a partner's declined venue vanished from their dashboard.

The families cover the likely words. A word nobody guessed still lands a venue
under "All" only (visibly, with a warning, but not under its proper tab). Please
send the actual list of states in the workflow.

---

## P1 — features that are built and waiting on you

Each of these is **fully built and shipping**. The portal detects whether the
endpoint exists (a 404 means "not deployed", cached per tab; a 403 or 417 is a
real error and is re-thrown) and **changes what it promises accordingly**.
Deploying any of them turns the feature on with **no frontend release**.

### 5. Resumable setup — `backend/venue_drafts.py`

📄 Full spec: **`docs/RESUME-SETUP.md`**

A partner three steps into listing a venue loses everything if a delivery
arrives. Drafts currently live in `localStorage`, which survives a reload but not
a different device.

```
save_venue_draft(draft_id, step, completed, venue_name, payload)
    -> {draft_id, step, completed, venue_name, payload, modified}
list_venue_drafts()          -> [ …same, WITHOUT payload, newest first ]
get_venue_draft(draft_id)    -> …same, WITH payload   (404 if not yours)
discard_venue_draft(draft_id) -> {ok: true}
```

Doctype **`Venue Draft`**: `vendor` (Link → Vendor Profile), `step` (Data),
`completed` (Small Text, JSON array), `venue_name` (Data), `payload` (Long Text).

**`payload` is opaque — store and return it byte-for-byte, do not parse or
validate it.** That is what keeps "add a field to the wizard" a frontend-only
change. `step`, `completed` and `venue_name` are lifted out into columns only so
the listing can sort and display without loading the blob.

Ownership is resolved **from the session**, never from a parameter — a draft holds
an address and a phone number.

### 6. Background menu import — `backend/menu_import.py`

📄 Doctypes and worker in the file's docstring.

Today the parse runs inside the HTTP request, so closing the tab loses it. The
design promises *"leave the page and we'll email you the moment your menu is
ready"* — the portal does **not** show that line until this exists.

```
start_menu_import(venue_name, file_name)  -> a Menu Import doc
get_menu_import_status(name)              -> {status, stage, processed, total,
                                              categories_found, missing_price_count,
                                              created_count, skipped_count, errors[]}
cancel_menu_import(name)
```

`stage` is one of `uploaded | scanning | reading | checking | done | failed` and
drives the partner-facing checklist ("Found 4 categories · reading 38 items and
prices"). **Publish `total` and `categories_found` BEFORE importing**, not after —
they are what tell a partner we understood their file rather than merely that we
are busy.

Also needs the `shotright_menu_ready` email template (see §8).

### 7. Partner-authored moods — `backend/mood_suggestions.py`

```
get_moods()                  -> the curated list
resolve_mood(text)           -> {status: "canonical"|"suggested", mood, label}
get_popular_moods(limit)     -> usage-ranked, for onboarding smart defaults
```

`create_venue` currently rejects any mood not already on the curated list, and
nothing exposes the list, so the portal **refuses** unmatched moods at entry —
honest, but a partner who wants "Masepa" has no way to ask for it.

**`get_moods` is needed either way.** Without it (or Vendor read permission on
the `Mood` doctype) the typeahead guesses from a hardcoded list and can offer a
mood the backend will then reject.

⚠️ **The endpoint is not the feature.** Suggestions need a **Desk review queue
sorted by `request_count`**, or they accumulate unseen and the venues attached to
them never reach customer search.

### 8. OTP + transactional email — `backend/otp_and_email.py`

📄 `docs/EMAIL-SETUP.md`

Registration has no verification, so junk accounts are trivial. Needs, **in this
order**:

1. Configure and **test outgoing mail** (SendGrid, or the existing SMTP mailbox —
   `frappe.sendmail` makes it a Desk setting either way). **Please confirm
   whether a SendGrid account actually exists.**
2. Create the Email Templates: `shotright_otp`, `shotright_welcome`,
   `shotright_password_reset`, `shotright_venue_submitted`,
   `shotright_menu_ready`, and — once §5 ships — `shotright_resume_setup`.
3. Create the `Vendor OTP` doctype.
4. Add `purge_unverified_accounts` to `scheduler_events`.
5. Deploy the methods.

🚨 **Do not deploy step 5 before step 1 works.** Verification live plus broken
mail locks every new partner out with no way through — strictly worse than the
junk accounts it prevents.

### 14. Venue photos — `backend/venue_photos.py`

> **Added 27 Jul. This was missing from the first version of this page** — §11
> below covers *menu item* photos only. A venue's own photographs were not
> asked for, because the portal had nowhere to upload one. It does now.

Sho't Right sells a **mood**. A customer picks a feeling on a Friday night and
gets a list of places. A listing with no picture asks them to choose where to
spend their evening on the strength of a name and a dress code.

The portal now has the whole thing — drag or choose several at once, downscaled
in the browser (a 5 MB phone photo goes up as ~300 KB), reorder, cover photo,
remove — in the setup wizard and on an existing venue. What it has nowhere to
put is the result.

```
set_venue_photos(venue_name, photos)   -> the saved list
get_venue_photos(venue_name)           -> [{file, file_url, file_name, idx, is_cover}]
delete_venue_photo(venue_name, file)   -> {ok: true}
```

`photos` is a JSON array of `{file, file_url, file_name, idx, is_cover}`, where
`file` is the **File docname the portal already created** — link to it, don't
re-upload or re-encode. `idx` is 1-based.

Doctype **`Venue Photo`** (child table): `file` (Link → File), `image` (Attach
Image), `file_name` (Data), `is_cover` (Check). On **`Venue`**: `photos` (Table)
and `cover_image` (Attach Image, read-only) — the cover denormalised so a search
result card is one row rather than a child-table load per result.

**`find_venues` should return `cover_image` on each result.**

**Order is data, not decoration.** Photo 1 is the image on the search card. A
partner who drags their best shot to the front has made an editorial decision
about how their business is presented; an unordered set silently discards it.

*What works today without you:* the upload half. The portal posts to stock
`upload_file` with `doctype=Venue`, so photos land as attachments on the Venue
and a moderator sees them in Desk. That is why the portal uploads regardless —
and why it currently tells the partner, **before** they start arranging
anything, that the pictures won't reach customers yet and the order isn't kept.
That copy disappears on its own the moment `get_venue_photos` answers.

**One decision for you:** does changing photos send a venue back for review? We
suggest adding or replacing one does, and *reordering an already-approved set*
does not — a partner nudging two approved photos shouldn't drop out of search
for a day. Tell us which, because "Save" and "Save and resubmit for review" are
not the same promise and the button has to say the right one.

### 9. Popularity signal — `backend/venue_option_popularity.py`

`get_popular_venue_options()` → the most-chosen dress codes and atmospheres, so
onboarding defaults reflect what venues actually pick. Without it the portal
offers the head of an alphabetical list, which is a guess dressed as a
recommendation. Low priority, genuinely useful.

---

## P2 — questions and decisions

### 10. Should `create_venue` accept the fields the designs collect?

The wizard collects **manager name, manager surname, contact number and a
description**. `create_venue` takes none of them, so they are dropped — the
portal warns the partner on the success screen, which is honest but not a fix.
The designs collect them, so presumably yes?

### 11. Menu item photos have nowhere to go

`add_product_item` has no image parameter. The portal uploads item photos
immediately so the partner sees them, then has nothing to link them to.

### 12. When a venue is declined, what does the partner get back?

The designs show a decline screen with the moderator's reasons and an "edit and
resubmit" path. That needs fields we do not have:

- `review_notes` — what the moderator actually said
- `reviewed_by`, `reviewed_on`
- ideally a child table of fix-items with a done flag, so the partner gets a
  checklist rather than a paragraph

And a decision: does the partner **edit the Venue**, or **get a Draft back**? We
think editing the Venue is right (the review history hangs off it), but if it is
a draft then `save_venue_draft` needs a `venue` link field.

### 13. Do drafts expire?

The resume card currently says **"nothing expires"**. If there is a cleanup job,
tell us the real TTL and we will change the copy. We are not printing "nothing
expires" over a row with a 30-day delete on it.

---

## How the portal handles you not having shipped yet

Every P1 item goes through one helper:

```js
withFallback(method, real, whenMissing)
```

- **404** → "not deployed". Cached for the tab, falls back, and the UI drops any
  copy that depended on it.
- **403 / 417** → a real error, re-thrown. Reading a permission failure as
  "feature absent" would silently downgrade the product instead of reporting a
  misconfiguration.

So you can deploy these one at a time, in any order, without coordinating a
frontend release. The portal starts using each one the moment it answers.

The one rule this buys us, and the reason it is worth the machinery: **the portal
never prints a promise the code behind it cannot keep.** "You don't have to wait,
we'll email you" and "nothing expires, we emailed you this link" only appear once
the thing that would send that email exists.

---

## Fastest way to tell us what landed

We cannot reach the bench from the build environment, so we cannot check this
ourselves — which is why five method names on this page are still marked
"unverified" rather than "wrong" or "fine".

Sign in to the portal, open the browser console, and paste this. It sends only
GETs, so nothing is created, changed or deleted. It prints one line per method.

```js
const METHODS = [
  'shotright.api.get_venue_products', 'shotright.api.add_product_heading',
  'shotright.api.add_product_item', 'shotright.api.bulk_import_products',
  'shotright.api.import_products_from_excel', 'shotright.api.delete_product_item',
  'shotright.api.get_moods', 'shotright.api.resolve_mood', 'shotright.api.get_popular_moods',
  'shotright.api.save_venue_draft', 'shotright.api.list_venue_drafts',
  'shotright.api.get_venue_draft', 'shotright.api.discard_venue_draft',
  'shotright.api.start_menu_import', 'shotright.api.get_menu_import_status',
  'shotright.api.cancel_menu_import',
  'shotright.api.set_venue_photos', 'shotright.api.get_venue_photos',
  'shotright.api.get_popular_venue_options',
  'shotright.api.send_otp', 'shotright.api.verify_otp',
]
for (const m of METHODS) {
  const r = await fetch(`/api/method/${m}`, { headers: { Accept: 'application/json' } })
  const body = await r.text()
  // A 404 naming the method means it is NOT DEPLOYED. Any other status —
  // including 403, 405 and 417 — means the method exists and simply objected
  // to being called with no arguments over GET, which is what we want to see.
  const missing = r.status === 404 && /Method Not Found|ModuleNotFound|AttributeError|not whitelisted/i.test(body)
  console.log(missing ? '❌ MISSING ' : '✅ present ', m, `(${r.status})`)
}
```

Send us the output and we will delete every "unverified" on this page. If a
method is named differently at your end it shows as MISSING here — that is the
answer we need most, because a wrong name is the one failure capability
detection cannot rescue us from.

## Verification, once each lands

| # | Check |
|---|---|
| 1 | Open a venue's menu. Items load, and adding a heading persists after a refresh. |
| 2 | Change the phone on Settings, reload. It persists. |
| 5 | Fill wizard steps 1–3, close the tab, open the dashboard **in a different browser**. The resume card is there, naming the venue and the step. Continue — the work comes back and lands on step 4, not step 1. Submit — the card disappears. |
| 6 | Upload a 500-row menu, close the tab, come back. Progress is still there and the counts are real. The completion email arrives. |
| 7 | Type a mood nobody has used. It is accepted as pending and appears in the Desk queue. |
| 8 | Register. The code arrives. An unverified account is purged on schedule. |
| 14 | Add four photos in the wizard, drag the third to the front, submit. The warning about photos not reaching customers is **gone**, and reopening the venue shows the same four in the same order with the right cover. |

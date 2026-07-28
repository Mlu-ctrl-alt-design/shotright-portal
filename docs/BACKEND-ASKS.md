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

### 1b. Can `update_venue` rename a venue — and what is it called?

> **Reported 27 Jul: editing a venue's name doesn't stick.**

Half of that was ours and is fixed: `venue_name` is the identifier on every
endpoint in this API, and the edit form was spreading the partner's *new* name
over it. Every rename said "update the venue called &lt;the name that doesn't
exist yet&gt;" and never mentioned the venue being edited.

The other half is yours, and we can't check it from here:

| Question | Why it matters |
|---|---|
| Is `shotright.api.update_venue` deployed at all? | It's another name out of `api_reference.py` — the same source as the five menu methods. |
| What does it take a **new name** under? | We now send `new_name` **and** `new_venue_name`; Frappe drops whichever isn't declared. If it's a third spelling, both get dropped and the rename silently does nothing. |
| Is `Venue` autonamed from `venue_name`? | If so, a rename needs `frappe.rename_doc` — a plain field write won't do it, whatever the parameter is called. |

The portal now **re-reads the venue after the write and compares**. If the name
didn't change it stays on the page and says so, rather than navigating on and
letting the partner believe it saved. That is a guard, not a fix — a partner
renaming their venue still can't.

Two other things the portal stopped doing on this call, worth knowing: it no
longer sends the whole loaded venue back (including **`workflow_state`** — a
client setting its own approval state), only an explicit list of writable
fields.

### 2. `update_vendor_profile` has no `phone` — ✅ reported deployed 27 Jul

The Settings phone field was read-only, because a control that accepts input and
silently discards it is worse than one that explains itself. **It is a control
again**, sending `phone`.

We still can't check the parameter name from here. What makes that safe is the
post-save comparison already in place: the profile is re-read after the write, so
a differently-named parameter surfaces to the partner as *"saved, but your phone
number didn't stick"* rather than as a lie. **Tell us if it isn't `phone`** and
that warning goes away.

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

> **🔴 One field needed now that §6 is live and §8 isn't.**
>
> `get_menu_import_status` must return **`will_notify`** — true only when a
> completion email will genuinely be sent.
>
> This shipped ahead of outgoing mail, and the two promises are not the same
> promise. *"You can leave"* became true the moment the import was a server job.
> *"We'll email you"* needs a working mailer. Without a signal separating them,
> the portal would tell every partner to close the tab and wait for a message
> that is never sent — which is worse than making them watch a progress bar,
> because they stop watching.
>
> The portal now defaults it to **false** and shows the smaller, true promise
> ("leave and come back, it keeps going"). **Set `will_notify` true once the
> mailer is configured and the `shotright_menu_ready` template exists** — the
> sentence turns itself on, no frontend release.

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
> below covers *menu item* photos only.
>
> **Reported ready 27 Jul.** We can't confirm it from the build environment, so
> nothing on our side assumes it landed — the probe decides per tab, and if the
> names differ we fall straight back to the pre-deployment behaviour.
>
> **Please confirm the exact signature of `set_venue_photos`.** It is the one
> call where a mismatch used to be invisible: the endpoint existing and the
> endpoint understanding us are different things, and a `photos` argument spelt
> differently server-side is dropped by Frappe at HTTP 200. The portal now
> **reads the gallery back after writing it** and reports a short count rather
> than claiming a save, so this fails loudly now — but it fails at a partner,
> which is one place too far.

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

> **Promoted 27 Jul — this is now blocking a shipped screen, not a design.**
> Drop-in: **`backend/venue_review.py`**.

The decline screen is built and live. A partner opening it today is told, in as
many words, that **no reason was recorded** — because a decline is a workflow
state and nothing more, and there is no field for a moderator to write into.

That is honest, and it is a bad thing for a business owner to read about their
own livelihood. We are not filling the gap with a generic line: "your venue
didn't meet our guidelines" removes the awkwardness and replaces it with
something worse, because the partner acts on it, changes the wrong thing,
resubmits, and is declined again.

```
get_venue_review(venue_name)               -> {state, notes, reviewed_by,
                                               reviewed_by_name, reviewed_on,
                                               fix_items[]}
set_review_fix_item(venue_name, item, done) -> {ok: true}
```

On **`Venue`**: `review_notes` (Small Text, **plain text**), `reviewed_by`
(Link → User), `reviewed_on` (Datetime), `fix_items` (Table). Child table
**`Venue Fix Item`**: `label` (Data), `done` (Check, ticked by the *partner*).

`notes` is shown to the partner **verbatim**, in a quote block, attributed. It
is not summarised or reformatted on the way through — they came to the page to
read exactly what was said. So write it as a message to a business owner, not
as an internal moderation note.

**Two things that belong in the Desk, not in the endpoint:**

1. **Make `review_notes` required on the decline transition.** A workflow that
   permits an empty note will produce empty notes, and this whole item exists
   to stop that.
2. Stamp `reviewed_on` on the *transition*, not on every save — the screen
   renders it as a date, and a save today reads as "reviewed again today".

**The decision we need:** does resubmitting **edit the Venue** or **restore a
Draft**? We think the Venue (the review history hangs off it, and the partner
keeps one thing with one identity) and the shipped button goes to the venue's
edit form. If you'd rather it became a draft, `save_venue_draft` needs a `venue`
link field and that button changes. Those are different products — tell us
before you build either.

**Also, separately: we have no support address.** "Contact support" is wired to
a `mailto:` from `VITE_SUPPORT_EMAIL`, and that variable is deliberately not
defaulted — a guessed address doesn't bounce, it just never gets read. With it
unset the screen shows no support button and says so. **Send us the address.**
Better still would be a `contact_support(venue_name, message)` endpoint so the
partner's question lands attached to the venue the reviewer already has open,
rather than in a shared inbox with no context.

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
  'shotright.api.get_venue_review', 'shotright.api.set_review_fix_item',
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
| 12 | Decline a venue in the Desk with a note. The partner's Declined tab shows a **Why?** link, and the screen behind it quotes your note back, attributed to you and dated — instead of "no reason was recorded". |

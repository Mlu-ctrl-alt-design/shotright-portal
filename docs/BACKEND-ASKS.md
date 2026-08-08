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

### 19. Reported 8 Aug — three issues, two of them ours

> **19.a** *"When a user edits a venue they are unable to save because the moods
> are throwing an error."*
> **19.b** *"Images still cannot be attached, they also throw an error."*
> **19.c** *"On the dashboard 'discard this draft' button is not working."*

Logged together, and they turned out to be different in kind. **19.a was ours
and is fixed** — no server error was ever involved, and it was the same incident
as the `get_venue_detail` 404 reported minutes later. **19.b still needs you.**

**What we need for 19.b, and cannot get from here.** The browser's Network tab →
the failing `upload_file` → the **Response body**. The status line alone cannot
tell us who refused (see below); the body can. A screenshot of the red message
on screen is not enough either — the portal deliberately no longer prints server
internals to partners, so that sentence is ours, not the bench's.

#### 19.a — moods on save — ✅ FIXED, and it was ours, not yours

**No server error was involved.** Please take this one off your list.

`moods` is a child table, so a READ hands it back as ids, as child rows
(`{mood: 'MOOD-CHILLED'}`), or as labels depending on which endpoint answered.
The edit form seeded straight from that and matched with `.includes(mood.name)`
— so any shape but a flat list of docnames selected **nothing**, and the form's
own *"select at least one mood"* rule then refused to submit a venue whose moods
the partner had never touched. That is the "unable to save".

**The `get_venue_detail` 404 you reported minutes later for VEN-00008 is the
same incident.** When detail 404s we fall back to the dashboard row — a
different serialiser over the same child table, under no obligation to describe
it the way the form was written against. That is what turned a latent shape
assumption into a blocked save.

Two fixes, both frontend, both shipped:

1. **Read every shape.** `moodKeysOf()` accepts ids, child rows and labels, and
   the form resolves them against the Mood list by docname or by label. A key we
   can't resolve is **kept**, not dropped — an unknown mood is one we don't
   understand, not one the venue doesn't have, and dropping it would quietly
   propose deleting it on the next save.
2. **Compare moods as a SET.** They were compared as ordered JSON, so un-ticking
   a mood and putting it back counted as an edit — which sent `moods` — which is
   the one field `update_venue` cannot accept. A partner who changed their mind
   got §00 for it. Ordinary edits now never carry the mood list at all.

**We are still not guessing the write shape.** Being generous on a read is safe:
the wrong checkboxes are visible and correctable. Writing a guessed child-row
shape makes Frappe create empty rows and report success, silently erasing a
venue's moods. **§00 is unchanged and still needs you** — the moment a partner
genuinely changes their moods, we have to send them, and it still crashes.

**Still open on your side:** §00 (the write), and §0 (why `get_venue_detail`
404s on VEN-00008 while the dashboard lists it — the portal survives it, but it
is a real 404 and it is what exposed this).

#### 19.b — uploads: images AND the menu importer, one endpoint

> **Also reported 8 Aug:** *"in the edit menu the menu upload is not working."*
> **It is the same issue.** The menu importer posts to
> `/api/method/upload_file`, exactly as the photo uploader does.

**AND THAT NARROWS IT USEFULLY.** The two calls are not identical:

| | photos | menu import |
|---|---|---|
| `doctype` / `docname` | **`Venue` / `VEN-…`** | *not sent* |
| `is_private` | `0` | `1` |
| permission needed | write on that **Venue**, plus create on `File` | create on **`File`** only |

So if **both** are refused, the missing permission cannot be the Venue attach
grant you added on 28 Jul — the menu upload never asks for it. It would mean the
Vendor role cannot create a `File` **at all**, which fits everything we already
know: §14 established that the role has *no* doctype access, and that is exactly
why `upload_file`, `frappe.client.get_list` on File and `attachOrphans` all
failed together.

**If only the photo upload is refused**, it is the Venue grant and the menu
importer should still work. Whichever it is, the answer is one test upload away
and it decides the fix.

We've also stopped the portal blaming the partner for it — the menu importer was
saying *"We couldn't read that file"* over a request in which the file never
left their machine, which sends someone off to re-export a spreadsheet that was
never broken. It now separates a refused upload from an unreadable file, and
only offers "try another file" where another file could actually help.



**This one has a change of ours in it.** When the permission was reported done
we deleted the unattached-upload fallback, deliberately: it had been producing
photos that uploaded, appeared in the uploader, and were attached to nothing —
the partner saw success, the moderator opened the Venue and saw no pictures.
A quiet wrong result. We made a refusal loud on purpose.

**If attaching is still refused, that decision is now the visible failure.** We
think loud is still right — an orphaned photo is worse than a reported one — but
it means "images throw an error" is the expected behaviour of a permission that
is not actually in place, not a new fault. Worth being explicit about, because
it changes what the fix is.

**First, where the 403 comes from — the request is not hitting the bench
directly.** `shotright-portal.vercel.app` resolves to `64.29.17.3`, which is
Vercel's edge; the bench is `194.163.168.19`. Every `/api/*` call is proxied
server-side by the rewrite in `vercel.json`. The browser therefore reports
Vercel's address for a response that (almost certainly) originated on the bench,
and a 403 raised by the edge and a 403 raised by Frappe are indistinguishable
from the status line alone. **The response body separates them**: a Frappe
refusal carries `exc_type` and `_server_messages`; an edge refusal does not.

Three things to check on the bench, in order:

1. **Is the `Venue` attach permission actually live in this environment?** It
   was confirmed on 28 Jul. If the change was applied to one bench and the
   portal is pointed at another, this is the whole answer.
2. **Does the error name `Venue` or `File`?** They are different permissions and
   different fixes. Attaching is `Venue` write; anything reading the photos back
   is `File` read, which is the open half of §14.
3. **Is it a permission at all?** A 413 (file too large), a 417 from a validation
   hook, or a CORS failure on `/api/method/upload_file` all surface to a partner
   as "it threw an error" and none of them are the role permission.

The standing ask from §14 if the permission cannot stay: **a whitelisted
`upload_venue_photo(venue_name, file)` that elevates internally**, the same way
every other `shotright.api.*` method does. That removes the dependency on stock
Frappe endpoints for good, and it is the shape the rest of this app already has.

#### 19.c — "discard this draft is not working" — ✅ FIXED, also ours

Reported the same day. Two silent failure modes, and it was the first:

1. **The id was undefined.** We read `draft_id || id`. A listing built with
   `frappe.get_all` returns the docname as **`name`** and nothing called
   `draft_id` unless someone aliased it — so the id came back undefined and
   `discardDraft` returned early on its own guard. The button did nothing, said
   nothing, and looked broken because it was. Now reads
   `draft_id || name || id`.
2. **A 200 that deletes nothing** was indistinguishable from success. Discard
   now re-reads the listing and confirms the draft is gone; if it is still
   there the partner is told so and the card stays, because the card is the
   truth.

**Worth confirming on your side:** does `list_venue_drafts` return `draft_id`,
per the contract in `docs/RESUME-SETUP.md`, or only `name`? We now handle both,
so this is not blocking — but if it is `name`, the same question applies to
`get_venue_draft` and `discard_venue_draft`, which we call with `draft_id`. We
send **both** `draft_id` and `name` on discard for that reason.

#### Related and still open

- **§0c** — uploaded photos rendering as broken links. Different failure
  (reading, not attaching) and not resolved by anything above.
- **§14** — can the Vendor role list `File` rows for its own venue?

### 00. `update_venue` crashes on `moods` — every venue edit, 28 Jul

```
File "apps/shotright/shotright/venue_service.py", line 89, in update_venue
    venue.update(fields)
File "apps/frappe/frappe/model/base_document.py", line 321, in _init_child
    value["doctype"] = doctype
TypeError: 'str' object does not support item assignment
```

**`moods` is a child table on `Venue`, and `venue.update()` cannot take a list
of ids.** `_init_child` expects a dict per row and assigns into it, so a list of
strings raises *before anything is written* — the whole edit is lost, not just
the moods.

**The asymmetry is the bug:** `create_venue` accepts mood ids as strings quite
happily. `update_venue` passes them straight to `venue.update` and does not. A
venue can be created with moods but never edited with them.

**Please make `update_venue` accept the same mood shape `create_venue` does.**

What we've done meanwhile, and what we deliberately have NOT:

- The form now sends **only fields the partner actually changed**, so editing a
  dress code no longer carries the mood list. That alone stops the crash for
  most edits, and is the right behaviour regardless.
- When moods genuinely change we still have to send them, so we catch this
  specific `TypeError`, drop the field, retry, and tell the partner *"couldn't
  update the moods"*. The rest of their edit lands.
- **We are not guessing the child-row shape.** `[{mood: id}]` would work if the
  child field happens to be called `mood` — and if it is called anything else,
  Frappe writes empty rows and reports success, which silently erases a venue's
  moods. That is strictly worse than not saving them. Tell us the field name and
  we'll send rows.

### 0b. `get_venue_detail` omits `address`

> **Reported 28 Jul:** *"when I open a venue to edit it the address does not
> show even though I know I set it."*

`get_venue_detail` and `get_vendor_dashboard` are different serialisers over the
same doctype and do not return the same fields. The venue LIST shows each
venue's address, so the data is plainly there — the edit form was asking the one
endpoint that leaves it out, and rendering the blank as though nothing had been
typed.

**That is a data-loss path, not a cosmetic one:** a partner opens the form, sees
an empty address, saves, and has now genuinely erased it.

We fill the gap from the dashboard row when detail comes back missing
`address`, `latitude`, `longitude`, `moods` or `operating_hours`. **Please make
`get_venue_detail` return everything the edit form writes** — one serialiser
that omits a writable field will do this again with the next one.

### 0c. Uploaded photos render as broken links

> **Reported 28 Jul:** *"the uploaded pictures are showing as broken links."*

An `<img>` is a plain browser GET. **It carries no `Authorization` header** —
our token only rides on axios calls — so if these files are served as private,
the browser gets a 403 and draws the broken-image glyph.

Two questions, and we can't answer either from here:

1. **Are venue attachments public?** We post `is_private: 0` to `upload_file`,
   but a file attached to a doctype can end up private depending on the doctype's
   settings. If they are private, `<img>` can never load them and we need either
   public files or a signed/public URL on `get_venue_photos`.
2. **What does `file_url` actually look like** — `/files/…`, `/private/files/…`,
   or an absolute URL? Our host rewrites `/files/*` and `/private/files/*` to the
   bench, so a bare path should work; an absolute URL to the bench would hit CORS
   and auth directly.

Meanwhile a tile that fails to load now says *"Can't show this one — it uploaded
and it's on the venue, we just can't load it back here yet"* instead of a torn
paper icon. That's honest, but it isn't a fix.

### 0. `get_venue_detail` 404s on a venue the dashboard just listed

> **Live on production, 28 Jul.** Signed in as a real partner, clicking **See
> why** on their own declined venue:

```
GET …/api/method/shotright.api.get_venue_review?venue_name=VEN-00002  417 (Expectation Failed)
GET …/api/method/shotright.api.get_venue_detail?venue_name=VEN-00002  404 (Not Found)
```

**`get_venue_detail` 404s for `VEN-00002` while `get_vendor_dashboard` returns
`VEN-00002` in the same session, to the same user, seconds earlier.** That is
the whole bug. The partner reached the link by clicking a row the dashboard
gave them, so the venue provably exists and provably belongs to them.

We have made the portal survive it — every single-venue screen now falls back
to the dashboard row — but the endpoint is still wrong and we can't see why
from here. Candidates, in the order we'd check them:

1. **Identifier.** We send the docname (`VEN-00002`) as `venue_name`. If
   `get_venue_detail` looks up by the *title* field rather than by `name`,
   it 404s on every venue. This exact confusion has bitten us twice already
   (see §1b) — `venue_name` is a docname on some methods and a title on others.
2. **Ownership check.** If it resolves the vendor differently from
   `get_vendor_dashboard`, it will 404 rather than 403 on a venue it can see.
3. **Not deployed under that name.** The 404 carries no `Method Not Found` text,
   which argues against this, but it's cheap to rule out.

**Please tell us which, and what the parameter should be.** Also, if a venue
genuinely isn't the caller's, **return 403, not 404** — 404 is
indistinguishable from a missing method and we have to guess which we're
looking at.

**The 417 is solved — it was never deployed under that name.** You built the
read side as **`get_review_fix_items`**; `get_venue_review` never existed, so
attribute resolution fails before any handler runs and Frappe returns 417 rather
than a clean 404. Ours now tries both names in order, `get_review_fix_items`
first. **Nothing needed from you on this one.**

Worth flagging for next time, though, since it cost a day between us: our
capability detection keys on **404** to mean "not deployed", which is what
Frappe returns for a method that isn't whitelisted. An `AttributeError` on the
module surfaces as **417**, which we read as "deployed and raising" — the exact
opposite conclusion. If there's a way to make a missing attribute 404 like a
missing whitelist does, it would remove a whole class of misdiagnosis.

(For the record, `get_venue_review` *was* named — it is in §12's code block,
first line. Not worth relitigating; flagging only in case that block isn't what
you worked from, since the rest of the section describes fields and a child
table you'd want to check against what you built.)

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

> ✅ **REPORTED LIVE 28 Jul — OTP and the mail service are set up.**
>
> Nothing on our side needed changing: registration branches on
> `register_vendor` returning `otp_required`, so verification turned itself on.
> Two flows that were built but unreachable are now load-bearing — **password
> reset** and **resend code** — and both have UI tests as of today, because a
> flow somebody reaches for while already locked out is the worst place to find
> the first bug.
>
> **We have NOT switched the email promises back on, and here is why.**
>
> "Mail is configured" and "this particular message is sent" are different
> facts, and we have been bitten by conflating them once already this week: §6
> shipped before mail, and the portal spent days telling every partner *"we'll
> email you the moment your menu is ready"* with no mailer behind it. The fix
> was one capability flag per claim, and that discipline only pays if we keep it
> now that the tempting thing is to relax it.
>
> So, three separate questions — a yes to one is not a yes to the others:
>
> 1. **Menu import.** Does the finished job actually send, and does
>    `shotright_menu_ready` exist? If so, return **`will_notify: true`** on
>    `get_menu_import_status` and the sentence turns itself back on with no
>    release from us. Nothing else will make us print it.
> 2. **Venue decisions.** Is there an email when a venue is approved or
>    declined? `shotright_venue_submitted` is a *submission* confirmation, which
>    is a different message. Until you confirm a decision email exists, the
>    pending screen says *"the decision appears on this page"* — true, and less
>    than we'd like to say.
> 3. **Anything else** on the template list that is now genuinely sending.
>
> Tell us which of those are real and we will wire each to its own signal.
>
> **One question about login.** OTP lives on REGISTRATION, so a partner who
> already has an account goes straight in — correct, and probably what you're
> seeing if you tested with an existing login.
>
> But it exposed a hole on our side, now fixed: `login` never branched on
> `otp_required`. If your bench answers login for an *unverified* account with
> `{otp_required: true}` and no token, we used to set "authenticated" anyway and
> drop the partner on a dashboard with nothing to authenticate with. Login now
> routes to the verification screen exactly as registration does, and refuses to
> claim a session it has no token for.
>
> **So: what does `login` return for an account that exists but hasn't verified?**
> `otp_required`, or a hard error? We handle both, but we'd rather know than
> infer.

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

> ✅ **RESOLVED 28 Jul — the Vendor role can attach to `Venue`.** Photos now
> land on the venue where moderators can see them. The unattached fallback has
> been removed, so a refusal is a loud error again rather than a silent orphan.
> Thank you — that was the fastest turnaround on this page.
>
> **One thing this did NOT fix, and we'd like to know either way:** attaching is
> `Venue` permission; reading photos back is `File` permission. If the Vendor
> role still can't list `File`, `get_venue_photos` remains the only route and
> the uploader still opens empty on an existing venue (it says so — see the
> "we can't show you the photos already on this venue" notice). **Can a vendor
> list their own venue's `File` rows?** If not, `get_venue_photos` is the ask.
>
> The history below is kept because the lesson outlived the bug.
>
> 🚨 **28 Jul, from a partner's screen.**
>
> ```
> cosmos_1492129323.jpeg didn’t upload: User mlumanda@gmail.com does not have
> doctype access via role permission for document Venue
> ```
>
> **The Vendor role had no permission on the `Venue` doctype at all.** That is a
> sound way to build a Frappe app — everything goes through whitelisted
> `shotright.api.*` methods that elevate internally — but it meant **every stock
> Frappe endpoint we reached for was refused**, and we hit that wall three
> separate times without recognising it was one wall:
>
> | What we tried | Why it fails |
> |---|---|
> | `upload_file` with `doctype: 'Venue'` | needs write permission on the Venue |
> | `frappe.client.get_list` on `File` | needs read permission on File rows |
> | `frappe.client.set_value` on `File` (`attachOrphans`) | needs write on File |
>
> All three were reported to you separately — "images don't persist", the 403
> logout, the photo read falling back to nothing. **They are the same cause.**
>
> We asked for either a whitelisted `upload_venue_photo(venue_name, file)` that
> elevates, or attach permission on `Venue`. **You granted the permission**, so
> stock `upload_file` works and no new endpoint is needed.
>
> The interim behaviour — uploading unattached so nothing was lost — is gone,
> and it is worth recording why we were glad to see the back of it. It produced
> a photo that uploaded, appeared in the uploader, and was attached to nothing.
> The partner saw success; the moderator opened the Venue and saw no pictures;
> nobody was placed to notice the difference. **A quiet wrong answer is worse
> than a loud failure**, and the only thing that justified it was that the wall
> was permanent. Once it wasn't, the fallback had to go.
>
> (We also stopped printing your messages as raw markup. `frappe.throw` takes
> HTML, `_server_messages` carries it through, and we render as text — so a
> restaurant owner read `User <strong>mlumanda@gmail.com</strong> does not have
> doctype access…`, tags and all. Ours to fix, and fixed. Worth knowing that
> anything you `frappe.throw` may end up in front of a partner.)

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

> **Mostly withdrawn 28 Jul — you already built it and we were not looking.**

**Our mistake, corrected.** This section used to say the bench had no field for
a moderator to write into. It has had three the whole time — `review_notes`,
`reviewed_by`, `reviewed_on` on `Venue` (`venue.json:81-94`) — and
`get_vendor_dashboard` has been handing them to this portal all along
(`vendor_dashboard.py:27`), put there deliberately so a declined venue could
render its reasons without a second round trip.

The decline screen was asking `get_venue_review` — undeployed — and reporting
the 404 to the partner as **"no reason was recorded"**, printed over a reason it
had already been given. Fixed on our side: the screen now reads the venue record
first and only falls back to an endpoint. **Nothing needs deploying for this to
work.** Also withdrawn:

- ~~stamp `reviewed_on` on the transition~~ — already done, `venue.py:31-54`,
  `_stamp_review()` only writes when `workflow_state` actually changes.
- ~~confirm the workflow states~~ — **Venue Approval**, `is_active=1`, states
  **Pending / Approved / Declined**. Recorded in `workflowState.js`.
- ~~the resubmit decision~~ — settled in shipped code, not in principle:
  `update_venue()` (`venue_service.py:84-95`) flips a Declined venue back to
  Pending on edit, and `Venue Draft` has no link to a `Venue`. It edits the
  Venue. Our button was already pointed at the right thing.

#### Also already built — we had the name wrong

`get_review_fix_items`, `set_review_fix_item` and `contact_support` are all
live. We were calling the read side `get_venue_review`, which never existed.
Both names are now tried in order and the **checklist renders** for the first
time. Two things we'd still like confirmed, since we're guessing from the name:

- **What does `get_review_fix_items` return** — a bare array of rows, or
  `{fix_items: [...]}`? We accept both, and read `name`/`label`/`done` off each
  row. If your fields differ, say so rather than letting us map silently.
- **`contact_support`'s parameter names.** We send `venue_name`, `venue`,
  `message` and `subject` together, because Frappe drops what it doesn't
  declare and we'd rather over-send than lose a partner's question. We only tell
  them it was sent if the response carries a `name`/`reference`/`id` or an
  explicit `ok` — a bare `null` is reported to them as *"we couldn't confirm
  that went through"*, with their text kept on screen. **If it returns nothing
  on success, please make it return the docname**, otherwise every partner who
  contacts support is told we're not sure their message arrived.

#### What is genuinely still open

**1. Make `review_notes` required on the decline transition.** Still open, and
now the *most* important item in this section — because of an interaction with
your own stamping logic. `_stamp_review()` clears `reviewed_by`/`reviewed_on` on
resubmit but **keeps `review_notes`**. So:

> declined with a note → partner edits and resubmits → declined again, moderator
> writes nothing → the July note is restamped with today's date and shown to the
> partner as the reason for the second decline.

A stale reason presented as a fresh one is worse than no reason: they already
fixed that, so they conclude the fix didn't count. The portal cannot detect this
— a kept note and a new note are byte-identical to us. **Only a required note on
the transition closes it.** (The alternative, clearing `review_notes` alongside
the other two on resubmit, is worse — it destroys the history.)

**2. `notes` is shown to the partner verbatim,** in a quote block, attributed.
Not summarised or reformatted on the way through — they came to the page to read
exactly what was said. So it needs writing as a message to a business owner, not
as an internal moderation note. `photos low-res, 3x no price` is a true note and
a cruel screen. Worth saying to whoever moderates, since the field is live and
2 declined venues are on the site right now.

**3. ~~We still have no support address.~~ Closed by `contact_support`.**
The partner's question now posts to the endpoint and arrives attached to the
venue the reviewer already has open, which is what we wanted and better than the
mailto. `VITE_SUPPORT_EMAIL` remains an optional second route — still not
defaulted to a guess — and the button no longer depends on it, so we've stopped
hiding the primary action on this screen. See the return-value note above; it is
the one thing that decides whether a partner is told their message arrived.

### 16. The menu is half-built — no edit, and delete probably never worked

A partner can add a heading and add items. Until 28 Jul they could not **change**
one at all: a dish priced at R450 instead of R45 had to be deleted and retyped.

And the delete they'd need for that goes through **`frappe.client.delete`** on
`Product Item` — which, per §14, the Vendor role has no doctype access to call.
**So "Remove" has most likely never worked for any partner**, and a mistake on a
menu is currently permanent.

```
update_product_item(item, item_name, price, description) -> {ok: true}
delete_product_item(item)                                 -> {ok: true}
```

The portal already tries `update_product_item`, `edit_product_item` and
`set_product_item` in order, and `delete_product_item` before falling back to
the generic delete — **pick any of those names and it works with no release
from us.** Until one exists, the edit form says the server has no way to save
the change and keeps the partner's wording on screen so they can copy it into a
new item.

**Please also confirm whether the Vendor role can call `frappe.client.delete`
on `Product Item`.** If it can, "Remove" works today and only edit is missing;
if it can't, both are blocked and a partner's menu is currently append-only.

### 17. Bookings — ✅ SHIPPED 7 Aug, reading live

> **Asked for 28 Jul: "we also need to see bookings within each venue."**
> **Answered 7 Aug: `shotright.api.get_venue_bookings`.**

```
get_venue_bookings(vendor_email, venue_name, from_date, to_date, limit)
  -> [ {name, arrival_date, arrival_time, adults, children, party_size,
        contact_name, contact_cell_phone, creation} ]
```

Identity from `get_current_vendor_email()`, ownership checked against
`Venue.vendor` before a row is read, no email parameter — so ADR-0004 holds and
nothing about how we authenticate changed. The tab reads live; the only frontend
change was the field mapping.

**Four backend decisions, and what the portal does with each.** All four are
right, and all four are load-bearing on this screen:

| Decision | What the screen does |
| --- | --- |
| `contact_email` withheld — the customer got their own confirmation from `create_booking` | Nothing shows an email. Name + cell is what running a door needs, and there's a `tel:` link on the number so it dials |
| `party_size` computed server-side, matching `booking_register.py` | We render the server's number and never re-derive it. Adults/children are split out **only when there are children**, because a high chair is a different table — but the total is always yours |
| Not gated on `workflow_state` | Correct, and invisible on our side by design: a venue back in Pending on Thursday still shows Friday's arrivals |
| `from_date`/`to_date` inclusive and independent; `limit` cint'd and capped at 500 | Upcoming sends `from_date = today` computed in **local** time (`toISOString()` is UTC and would show tomorrow's book to anyone opening the portal before 02:00 SAST). "Earlier" sends `to_date = yesterday`. We ask for 100 and say "showing the first 100" when a page comes back full, rather than implying the list ends |

**No status field, so nothing is badged.** The endpoint returns no state and
isn't gated on one, so a "Confirmed" pill would be the portal making a promise
the server never made. If a status ever appears we'll render it; we won't invent
one. Same rule as everywhere else on this project.

**The blind state is kept and still tested.** `bench.deploy.get_venue_bookings`
can go back to false and the tab returns to saying it cannot see bookings at
all. Partners' benches update at different times, and an empty diary drawn over
a missing method is the worst outcome on this screen. There is now a third
state as well: deployed and throwing reads as *"We couldn't load your bookings
just now"* with a Try again — a bad minute and an unbuilt feature need different
actions from the partner and different actions from us.

Covered by `verification/verify22.mjs` (31 checks) and eleven RTL checks.

**One question left open, unchanged from 28 Jul:**

**Does a partner ACT on a booking** — confirm, decline, mark as arrived — or
only read it? `get_venue_bookings` is read-only, which is a complete answer for
a diary. The shapes for `confirm_booking` / `decline_booking` are written in
`services/bookings.js` and deliberately wired to nothing, because a confirm
button that reaches nobody is worse than no button. If the answer is "read
only", say so and we'll delete them.

Worth a decision separately: the PRD still lists **"bookings management"** under
*Out of scope*. Reading a diary is now shipped and clearly in. Acting on one is
the line, and it's the difference between a tab and a product area.

### 18. Legal documents — built, guessing at the contract

> **Told 7 Aug: "we've added legal documents in the backend, vendors need to
> accept these too."** No method name, no shape, no doctype came with it — so
> everything below is the portal's best guess, and the four questions at the
> end are the ones that decide whether it works on the first deploy.

**The names we try, in order.** First match wins; the rest are never called:

```
list    get_legal_documents · get_vendor_legal_documents
        list_legal_documents · get_terms
accept  accept_legal_document · accept_legal_documents
        record_legal_acceptance · accept_terms
```

**The shape we read**, with aliases so near-misses land:

```
{ name, title|document_name|document_type, version|document_version|revision,
  effective_date, content|body|document_html, url|file_url,
  required, accepted|is_accepted, accepted_on }
```

`required` defaults to **true** when absent and `accepted` defaults to
**false** — both default to the cautious reading, because the cost of being
wrong that way is asking someone to accept twice and the cost the other way is
a venue going live under an agreement nobody made.

**What we send on accept:** every alias for the document id at once
(`document`, `legal_document`, `name`, `document_name`), plus `version` and
`accepted: 1`. Frappe drops what the handler doesn't declare, so this costs
nothing and removes a whole class of silent no-op.

#### The one thing we need you to know we're doing

**We read the acceptance back before we tell the partner it was recorded.** A
200 from Frappe means the request routed, not that anything was written — and
this project has shipped six bugs of exactly that shape. On a menu price that
costs a retype. On a consent record it would put *"Accepted 7 August 2026"* on
screen over an empty table, and nobody would find out until there was a dispute
and nothing to produce. If `get_legal_documents` doesn't come back showing the
document accepted, the partner is told it didn't save. Please don't optimise
that read-back away by making accept return the document — actually, **do**:
if `accept_legal_document` returns the updated document, say so and we'll trust
its response instead of making a second call.

#### Where it's enforced — a product decision we made, flag it if it's wrong

A partner can sign in, read their dashboard, edit venues and answer a decline
with a banner up. **A venue cannot be submitted for approval until the
outstanding documents are accepted** — that's the moment a listing enters your
review queue and starts heading for real customers.

The alternative is blocking the whole portal at login. Stronger legal position,
and it's one constant to change (`ENFORCE_AT` in `services/legal.js`). We
didn't, because a misconfigured document or a flaky accept endpoint would lock
every partner out of their own data at once, and the portal can't tell that
apart from a legitimate block from the inside.

**We never enforce what we can't ask.** If the list endpoint is absent we can
neither show a partner what they're agreeing to nor record that they did, so we
don't hold them to it — a venue reaching review unaccepted gets caught by a
human, a partner who can't submit because an endpoint is missing gets caught by
nobody. Same for the wizard: the draft is saved server-side *before* the
redirect, so five steps of work survive being sent to the legal screen.

#### Four questions

1. **What are the real method names and the real field names?** One reply and
   the list above collapses to the truth. If one of our guesses is already
   right, nothing changes at all.
2. **Is acceptance versioned?** We send `version` and display it, on the
   principle that *"they accepted"* is a much weaker record than *"they
   accepted v2.1 on this date"*. If you publish a new version of the Terms,
   does `accepted` go back to false for everyone? We assume yes and will show
   the banner again — confirm, because the alternative (a silent update nobody
   re-accepts) is worth knowing about deliberately rather than by accident.
3. **Is the document body HTML, and is it sanitised on save?** We render it
   with `dangerouslySetInnerHTML`, the same as the wizard renders a partner's
   own summary. That's fine for staff-authored copy off our own bench and not
   fine if the field can be edited by anyone else.
4. **What about registration?** Right now nothing on the register screen
   mentions terms, deliberately: `register_vendor` would silently drop an
   `accepted_terms` kwarg it doesn't declare, and a tickbox whose state we
   can't record is worse than no tickbox. If you want acceptance captured at
   sign-up, it needs either a declared field on `register_vendor` or a
   guest-readable list endpoint — tell us which and we'll wire it.

Covered by `src/test/legal.test.jsx` (24 checks) and
`verification/verify23.mjs` (37 checks), including a fake bench that reproduces
the silent-200 write so the read-back is provably wired.

### 13. Do drafts expire?

The resume card currently says **"nothing expires"**. If there is a cleanup job,
tell us the real TTL and we will change the copy. We are not printing "nothing
expires" over a row with a 30-day delete on it.

### 15. How long does approval take? We tell partners nothing.

Right now a partner who submits a venue gets one sentence — *"This venue is with
our team"* — and no answer to the only question they have, which is **when**.
There is no submission date on the screen, no expected turnaround, and no way to
tell a venue submitted this morning from one submitted three weeks ago.

We are not inventing a number. "Usually approved within 2 working days" is a
commitment the business makes, not a string the frontend gets to choose, and the
cost of getting it wrong is a partner who stops checking. Three things, cheapest
first:

**a. A submission timestamp.** The one thing we could show today and can't.
`reviewed_on` is cleared on resubmit (correctly), `creation` is when the record
was made rather than when it was submitted, and `modified` moves whenever
anyone touches the row. **We need a `submitted_on` (Datetime) stamped on the
transition into Pending** — including on resubmit. With just that we can say
"Submitted 24 July" and "with our team for 3 working days", both of which are
true without anyone promising anything.

**b. A turnaround figure, if you're willing to commit to one.** A number and its
unit — we'll render "usually approved within N working days" and nothing else.
If you'd rather not commit, say so and we'll ship (a) alone; a date with no
promise beats a promise nobody can keep.

**c. Per-section review states — the bigger one.** The designs show *Venue
details / Operating hours / Moods & vibe / Menu photos & prices* each carrying
its own Approved / In review state, plus items that are waiting on a third party
(a 360° tour booking) or on the partner (a payout account). Today the workflow
has **three states on the whole Venue** and nothing underneath it. That's a
data-model change, not a screen: something like a `Venue Review Section` child
table with `section`, `state`, and an optional `blocked_on`. Worth scoping
before it's designed further, because everything on that mock — the "six of your
eight items are cleared" line included — derives from it.

Related, and blocked on §8: while mail is unconfigured we cannot say "we'll
email you either way, so there's no need to check back". That sentence was on
the pending screen and has been removed for the same reason it was removed from
the menu importer.

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

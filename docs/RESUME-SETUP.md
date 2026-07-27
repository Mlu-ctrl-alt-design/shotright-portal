# Resume setup — "Pick up where you left off"

**Status:** frontend built and shipping against a **local (browser) mock**.
Backend endpoints below are **not yet deployed**. The portal detects that and
changes what it promises — see [What the mock cannot do](#what-the-mock-cannot-do).

---

## 1. The problem

A partner starts listing a venue, gets three steps in, and a delivery arrives.
Today the portal forgets them completely. When they come back, setup starts from
an empty step 1 — and the second attempt is the one people abandon.

The five-step wizard asks for a venue name, a manager, an address, a map pin, a
mood set, three time ranges and a whole menu. That is not a form you finish
between two customers. It has to survive being put down.

## 2. What we built

- **Autosave** in the wizard: debounced at 1.2s within a step, and immediately on
  every step change.
- **A resume card** on the dashboard: which venue, how far, when it was saved, and
  one button back into the exact step.
- **A resume link**: `/venues/new?draft=<draft_id>`, which restores all five
  steps' state and lands on the saved step.
- **Discard**, so a draft the partner has given up on can be cleared rather than
  nagging them for ever.
- The draft is **discarded automatically** the moment its venue is created.

Files: `src/services/setupDraft.js`, `src/services/wizardSteps.js`,
`src/hooks/useSetupDraft.js`, `src/components/ui/ResumeSetupCard.jsx`,
and the wiring in `VenueWizard.jsx` / `Dashboard.jsx`.

## 3. Endpoints we need

Four whitelisted methods on the flat `shotright.api.*` namespace, matching the
convention already in use. A reference implementation is in
`backend/venue_drafts.py` — it is a drop-in, not a requirement; only the
signatures and return shapes below are load-bearing.

> **The one thing that will silently break this:** Frappe's `call()` drops kwargs
> that are not in the declared signature, at HTTP 200, with no error. Three
> separate bugs this project has already hit came from that. If a parameter below
> is renamed or omitted server-side, the portal will appear to save and will
> actually save nothing. Please keep the names exact, or tell us what they are.

### `save_venue_draft(draft_id, step, completed, venue_name, payload)`

Creates on a missing/absent `draft_id`, updates otherwise.

| param | type | notes |
|---|---|---|
| `draft_id` | str, optional | omitted on first save; server mints one |
| `step` | str | one of `mood`, `details`, `hours`, `menu`, `review` |
| `completed` | JSON str | array of step keys already finished |
| `venue_name` | str | denormalised for the listing; may be `""` |
| `payload` | JSON str | **opaque to the server** — see §4 |

Returns:

```json
{
  "draft_id": "VD-00007",
  "step": "menu",
  "completed": ["mood", "details", "hours"],
  "venue_name": "Corner Kitchen & Bar",
  "payload": { "...": "..." },
  "modified": "2026-07-25 14:02:11"
}
```

### `list_venue_drafts()`

Returns the calling vendor's unfinished drafts, **newest `modified` first**,
**without `payload`** — the dashboard needs the summary, not 200KB of menu per
draft. Same fields as above minus `payload`.

### `get_venue_draft(draft_id)`

The full draft, `payload` included. `404` if it does not exist or does not belong
to the caller. The portal treats 404 as "gone" and says so plainly.

### `discard_venue_draft(draft_id)` → `{"ok": true}`

Hard delete is fine. Nothing else references a draft.

## 4. `payload` is ours, not yours

`payload` is a JSON blob the portal writes and reads. **Please store and return
it byte-for-byte and do not parse, validate or migrate it.**

That is the whole reason this design works: adding a field to the wizard is a
frontend change with no backend deploy. The moment the server starts having
opinions about the blob's shape, every wizard change needs a coordinated release.

Its current shape, for information only:

```json
{
  "moods":   { "moods": [ { "mood": "…", "status": "…", "label": "…" } ] },
  "details": { "venue_name": "…", "manager_name": "…", "contact_number": "…",
               "address": "…", "latitude": 0, "longitude": 0,
               "dress_code": "…", "atmosphere": "…", "summary": "…" },
  "hours":   { "days": ["mon"], "weekendStartsFriday": false,
               "weekday": {"start": "09:00", "end": "20:00"},
               "weekend": {"start": "09:00", "end": "21:00"},
               "publicHoliday": {"start": "10:00", "end": "19:00"} },
  "menu":    { "categories": [ { "id": "…", "name": "…", "items": [] } ] }
}
```

`step`, `completed` and `venue_name` are the exception — they are lifted OUT of
the payload into real columns, because the listing endpoint has to sort and
display them without loading the blob.

## 5. Doctype

**`Venue Draft`** — one row per unfinished setup.

| field | type | notes |
|---|---|---|
| `vendor` | Link → Vendor Profile | owner; every read filters on it |
| `step` | Data | current step key |
| `completed` | Small Text | JSON array of step keys |
| `venue_name` | Data | for the listing |
| `payload` | Long Text | opaque JSON, §4 |
| `modified` | (standard) | drives "saved 2 days ago" |

Permissions: a vendor reads and writes **only their own**. The portal never sends
a vendor id — resolve it from the session, the same way the venue endpoints
already do. A draft contains an address and a phone number, so a `draft_id` that
leaks across accounts is a real disclosure, not a nuisance.

**Retention:** drafts do not expire (the card says so). If that is not
acceptable, tell us the real TTL and we will change the copy — we must not print
"nothing expires" over a row with a 30-day cleanup job on it.

## 6. Two things that need a decision

### 6a. The resume email

The design says: *"Nothing expires — and we emailed you this link too."*

Nothing sends that email today. It needs a template and a trigger, and the
sensible trigger is **not** "on every save" — it is *a draft that has gone
untouched for ~24 hours and is past step 1*. Suggested:

- template `shotright_resume_setup`, alongside the OTP and menu-ready templates
  in `backend/otp_and_email.py`
- a daily scheduled job over `Venue Draft` where `modified < now - 24h`
  and `step != 'mood'` and no resume email sent yet
- one email per draft, ever — a nightly nudge is spam

**Until that exists, the portal does not show that line.** It shows what is
actually true instead. Please tell us when it ships and we will switch the copy
on via the same capability check.

### 6b. Does a declined venue become a draft again?

Related to the declined-venue work: when a moderator declines a submission, does
the partner **edit the Venue** or **get a Draft back**? We think editing the
Venue is right — the review history hangs off it — but it is your call, and if it
is a draft then `save_venue_draft` needs a `venue` link field to tie them.

## 7. What the mock cannot do

Until the endpoints land, drafts live in `localStorage` under
`shotright.venueDrafts`. That is a genuine improvement — it survives a reload, a
closed tab and a browser restart — but it is not what the design promises, and
the portal does not pretend otherwise:

| | local (today) | server (once deployed) |
|---|---|---|
| survives reload / closed tab | ✅ | ✅ |
| survives a different device | ❌ | ✅ |
| survives a cleared cache / private window | ❌ | ✅ |
| can be emailed as a link | ❌ | ✅ (once §6a ships) |

The resume card's reassurance line is keyed off this. With a server draft it
reads *"Nothing expires — and we emailed you this link too."* With a local one it
reads *"Saved in this browser. Finish on this device, or start again elsewhere."*

This is the same rule the menu import already follows for *"you don't have to
wait, we'll email you"*: **a promise is only printed when the code behind it
exists.** The switch is automatic — `withFallback` treats a 404 as "not deployed"
and nothing else, so the day these endpoints appear the portal starts using them
and the copy changes with no frontend release.

## 8. How to verify it once deployed

1. Start a venue, fill steps 1–3, close the tab.
2. Reopen the dashboard **in a different browser**. The resume card should be
   there, naming the venue and reading *step 4 of 5, Menu options*.
3. Continue setup — all three completed steps must come back filled, and the
   wizard must land on step 4, not step 1.
4. Submit. The card must disappear, and `list_venue_drafts` must no longer
   return it.

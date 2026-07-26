# Backend integration — setting the scene

The portal is finished through submit and runs entirely on in-memory fixtures.
Nothing on the Frappe bench exists yet: **none of the Sho't Right doctypes are
installed**, verified by querying `bloop`/`crm.thedaystar.co.za` directly.

This document is the handover: what to build, in what order, and how to tell when
the switch can be flipped.

The frontend is already written against a fixed surface — every call site is in
`src/services/vendor.js`, and each one picks between the real endpoint and a mock
of the *same shape*. `backend/api_reference.py` is that surface as Python. When
the app exists, `VITE_USE_MOCKS=false` is the only frontend change.

---

## 1. Doctypes

Three of the decisions taken during the build change the schema from what issues
#14–#20 describe. Build to this, not to the issues.

### `Vendor Profile` (#14)
`user` (Link → User), `vendor_name`, `business_name`, `phone`.
An existing Customer Profile on the same User must **not** block registration.

### `Mood` (#20) — gains aliases
| Field | Type | Note |
|---|---|---|
| `mood_name` | Data | Canonical, Desk-managed |
| `aliases` | Child table of Data | **New.** The whole point of C1 |

Aliases are what stop the taxonomy fragmenting: "boys night", "bn out" and
"Boys Night Out" must all resolve to one Mood. Seed from
`src/services/mockBackend.js`, which already carries a working alias set drawn
from the design frames.

### `Mood Suggestion` — new, from C1
`suggested_name`, `status` (Pending Review / Approved / Merged / Rejected),
`vendor_profile`, `merged_into` (Link → Mood).

Created when a partner types something that resolves to nothing. **A Desk review
queue for these is required and does not exist** — without it, suggestions
accumulate unseen and those venues never surface in customer search.

### `Venue` (#15)
`venue_name`, `vendor_profile`, `manager_name`, `manager_surname`,
`contact_number`, `address`, `dress_code`, `atmosphere`, `summary` (Text Editor),
`workflow_state`.

Two departures from #15:
- **`atmosphere` is its own field.** The design's review screen labels it "Dress
  code" a second time; that is a design bug, and the value shown there ("Out door
  laid back") is plainly not a dress code.
- **Operating hours are three ranges, not seven rows** (C3):
  `weekday_open/close`, `weekend_open/close`, `public_holiday_open/close`,
  `operating_days` (multi-select), `weekend_starts_friday` (Check).
  A per-day child table is more flexible but is not what the designs collect.

### `Venue Mood`
Child table on Venue linking to **either** a `Mood` or a `Mood Suggestion`. The
portal already sends `{mood, status, label}` per entry so the distinction
survives the round trip — don't flatten it to labels.

### `Product Heading` / `Product Item` (#17)
Item gains `image` (Attach Image) and `description` as **Text Editor**, not Data
— C4 and the rich-text editor respectively.

---

## 2. Endpoints

Exactly these, all whitelisted, all session-scoped to the calling partner:

| Method | Purpose |
|---|---|
| `auth.register_vendor`, `auth.get_vendor_session` | Registration and session rehydration |
| `vendor.get_dashboard` | Counts + recent venues |
| `vendor.get_my_venues`, `vendor.get_venue_detail` | List and detail |
| `vendor.create_venue`, `vendor.update_venue` | Create always enters review, never live |
| `vendor.get_moods` | Canonical list, for the typeahead |
| `vendor.resolve_mood` | **New (C1).** Text in → canonical Mood or a new Suggestion |
| `vendor.get_venue_lookups` | **New.** Dress codes and atmospheres |
| `vendor.get_venue_menu`, `vendor.create_product_heading`, `vendor.create_product_item`, `vendor.delete_product_item`, `vendor.import_menu` | Menu |
| `vendor.get_my_profile`, `vendor.update_my_profile` | Profile |
| stock `upload_file` | Menu item photos (C4) |

### `resolve_mood` is the one with real logic

```python
@frappe.whitelist(methods=["POST"])
def resolve_mood(text):
    key = normalise(text)                     # lowercase, strip punctuation, collapse spaces
    mood = match_canonical_or_alias(key)
    if mood:
        return {"status": "canonical", "mood": mood.name, "label": mood.mood_name}
    suggestion = get_or_create_suggestion(text)
    return {"status": "suggested", "mood": suggestion.name,
            "label": suggestion.suggested_name, "near": nearest_canonical(key)}
```

Keep this on the server. The Excel importer and the form both go through it, and
if the matching lives in the browser those two will drift apart.

---

## 3. Things the client cannot enforce

The portal does these checks for fast feedback. They are **not** controls — the
API accepts whatever is posted to it.

| Check | Why it matters |
|---|---|
| **Sanitise `summary` and item `description`** | Rich text is authored as HTML and rendered by the customer app. ProseMirror only *emits* safe nodes; it does not constrain what reaches the endpoint. This is the highest-risk item here. |
| **Image type and size** (currently `image/*`, 5 MB) | Anything can be posted to `upload_file` |
| **Ownership on every read and write** | A partner must never load or edit another partner's venue |
| **Price is a positive number** | Parsed from CSV, which is user-supplied |

---

## 4. Cutover

1. Scaffold the `shotright` app; create the doctypes above.
2. Drop `backend/api_reference.py` into `shotright/api/` and fill in the bodies.
3. Seed `Mood` from the mock's canonical list **with its aliases**.
4. Build the Desk review queue for `Mood Suggestion`.
5. Set `VITE_USE_MOCKS=false` in Vercel. No frontend change.
6. **Check the session cookie survives.** If Frappe sets an explicit
   `Domain=bloop.thedaystar.co.za`, the browser rejects it on the portal's origin
   and login fails silently. It must stay host-only. This is the single most
   likely thing to go wrong on cutover day.
7. Re-run the wizard end to end against the bench.

### Verifying without guessing

The mock is the specification. For any endpoint, the shape the frontend expects
is the shape `mockBackend.js` returns — diff the real response against it rather
than reading the UI code.

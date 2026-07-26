"""
Closes C1 on the backend side.

DROP-IN: paste these three methods into `shotright/api.py` (they belong in the
flat `shotright.api.*` namespace the app already uses) and create the
`Mood Suggestion` doctype described at the bottom.

Why this exists
---------------
The product decision (C1) was that a partner types any mood they like: text that
matches the curated list resolves onto it, and anything genuinely new is filed
for staff to review and merge. The portal was built to that decision.

The live API cannot honour it. `create_venue` rejects any mood not already on the
curated list, and nothing exposes the list or accepts a suggestion. So the portal
currently REFUSES unmatched moods at the point of entry — honest, but a partner
who wants "Masepa" has no way to ask for it.

Adding the three methods below lets the portal go back to the designed behaviour.
The frontend already supports it: `MoodStep.jsx` still handles a
`status: "suggested"` result, and `MoodPill` still has the outlined variant for
one. Restoring it is deleting a branch, not writing a feature.

Two of these are useful even if C1 is ultimately reversed:
`get_moods` is needed either way — without it the portal's typeahead reads
fixtures and can offer a partner a mood the backend will then reject.
"""

import re

import frappe


def _normalise(text: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace. The comparison key.

    Must match the frontend's `normaliseMood()` exactly, or the two will
    disagree about whether a mood already exists.
    """
    text = (text or "").lower()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    return re.sub(r"\s+", " ", text).strip()


@frappe.whitelist(allow_guest=False)
def get_moods():
    """The curated Mood list, for the portal's typeahead and browse list.

    Returns aliases too so the portal can resolve locally when offline; the
    server remains the authority, because `resolve_mood` and `create_venue` both
    validate again.
    """
    moods = frappe.get_all("Mood", fields=["name", "mood_name"], order_by="mood_name asc")
    for mood in moods:
        mood["aliases"] = frappe.get_all(
            "Mood Alias",
            filters={"parent": mood["name"]},
            pluck="alias",
        )
    return moods


@frappe.whitelist(methods=["POST"])
def resolve_mood(text):
    """Resolve partner-typed text to a canonical Mood, or file a suggestion.

    Returns:
        {"status": "canonical", "mood": <Mood name>, "label": <mood_name>}
        {"status": "suggested", "mood": <Mood Suggestion name>,
         "label": <as typed>, "near": {"mood": ..., "label": ...} | None}

    Keep this on the server. The Excel importer and the form both go through it;
    if the matching lives in the browser those two will drift apart.
    """
    key = _normalise(text)
    if not key:
        frappe.throw("Please type a mood first.")

    # Exact hit on a canonical name...
    for mood in frappe.get_all("Mood", fields=["name", "mood_name"]):
        if _normalise(mood.mood_name) == key:
            return {"status": "canonical", "mood": mood.name, "label": mood.mood_name}

    # ...or on one of its aliases. This is what stops "boys night",
    # "bn out" and "Boys Night Out" becoming three different moods.
    alias = frappe.db.sql(
        """SELECT parent FROM `tabMood Alias` WHERE LOWER(TRIM(alias)) = %s LIMIT 1""",
        (key,),
    )
    if alias:
        parent = alias[0][0]
        return {
            "status": "canonical",
            "mood": parent,
            "label": frappe.db.get_value("Mood", parent, "mood_name"),
        }

    # Cheap containment check, enough to catch "boys night out party".
    near = None
    for mood in frappe.get_all("Mood", fields=["name", "mood_name"]):
        canonical_key = _normalise(mood.mood_name)
        if canonical_key in key or key in canonical_key:
            near = {"mood": mood.name, "label": mood.mood_name}
            break

    vendor = frappe.db.get_value("Vendor Profile", {"user": frappe.session.user}, "name")

    existing = frappe.db.get_value(
        "Mood Suggestion", {"normalised_name": key, "status": "Pending Review"}, "name"
    )
    if existing:
        suggestion_name = existing
        _record_request(existing, vendor)
    else:
        doc = frappe.get_doc(
            {
                "doctype": "Mood Suggestion",
                "suggested_name": (text or "").strip(),
                "normalised_name": key,
                "status": "Pending Review",
                "vendor_profile": vendor,
                "request_count": 1,
                "requesters": [{"vendor_profile": vendor}] if vendor else [],
            }
        ).insert(ignore_permissions=True)
        frappe.db.commit()
        suggestion_name = doc.name

    return {
        "status": "suggested",
        "mood": suggestion_name,
        "label": (text or "").strip(),
        "near": near,
    }


def _record_request(suggestion, vendor):
    """Count DISTINCT vendors asking for a suggestion, not raw requests.

    This number is the point of the queue: it turns "somebody typed something
    odd" into "eleven different partners independently asked for Amapiano
    Sundays", which is a product signal worth acting on.

    Counting requests rather than requesters would let one partner retyping the
    same mood eight times outrank a genuinely popular one — ranking noise to
    the top, which is precisely the inverse of what this is for.
    """
    if not vendor:
        return
    if frappe.db.exists(
        "Mood Suggestion Requester", {"parent": suggestion, "vendor_profile": vendor}
    ):
        return

    doc = frappe.get_doc("Mood Suggestion", suggestion)
    doc.append("requesters", {"vendor_profile": vendor})
    doc.request_count = len(doc.requesters)
    doc.save(ignore_permissions=True)
    frappe.db.commit()


@frappe.whitelist()
def get_popular_moods(limit=8):
    """The moods most used by other venues, for onboarding smart defaults.

    A new partner facing an empty mood field has to guess at a vocabulary they
    have never seen. Showing what venues like theirs actually chose turns that
    into recognition instead of recall, which is the difference between a step
    people complete and a step people skip.

    Ranked by DISTINCT VENUES, not by row count — the same reasoning as
    `_record_request`. Only approved venues count: pending ones have not been
    seen by staff, so letting them influence what everyone else is shown would
    make the list trivially game-able by bulk-submitting venues.

    The caller merges this into the browse list; it is a hint, not a filter.
    """
    limit = min(int(limit or 8), 24)

    rows = frappe.db.sql(
        """
        SELECT vm.mood AS name, m.mood_name, COUNT(DISTINCT v.name) AS venue_count
        FROM `tabVenue Mood` vm
        JOIN `tabVenue` v ON v.name = vm.parent
        JOIN `tabMood`  m ON m.name = vm.mood
        WHERE v.workflow_state = 'Approved'
        GROUP BY vm.mood, m.mood_name
        ORDER BY venue_count DESC, m.mood_name ASC
        LIMIT %s
        """,
        (limit,),
        as_dict=True,
    )

    # A brand-new platform has no usage to rank, and an empty "popular" list is
    # a worse first run than no feature at all. Fall back to alphabetical so the
    # onboarding hint always has something in it.
    if not rows:
        rows = frappe.get_all(
            "Mood",
            fields=["name", "mood_name"],
            order_by="mood_name asc",
            limit_page_length=limit,
        )
        for row in rows:
            row["venue_count"] = 0

    return rows


@frappe.whitelist()
def get_mood_demand(limit=20):
    """Desk-facing: pending suggestions ranked by how many partners asked.

    This is the queue staff should actually work from. Sorting the suggestion
    list by creation date buries a mood eleven partners requested under fifty
    one-offs, and the whole reason for collecting suggestions is to find the
    former.
    """
    return frappe.get_all(
        "Mood Suggestion",
        filters={"status": "Pending Review"},
        fields=["name", "suggested_name", "request_count", "creation"],
        order_by="request_count desc, creation asc",
        limit_page_length=min(int(limit or 20), 100),
    )


@frappe.whitelist(methods=["POST"])
def approve_mood_suggestion(suggestion, merge_into=None, mood_name=None):
    """Desk action: merge a suggestion into an existing Mood, or promote it.

    `merge_into` adds the suggested text to that Mood's aliases, so every venue
    that asked for it starts resolving correctly. Omit it (optionally passing
    `mood_name`) to create a brand-new canonical Mood instead.

    WITHOUT A DESK QUEUE CALLING THIS, SUGGESTIONS ACCUMULATE UNSEEN and the
    venues attached to them never surface in customer search. The queue is the
    part that makes C1 actually work — not this endpoint.
    """
    doc = frappe.get_doc("Mood Suggestion", suggestion)

    if merge_into:
        mood = frappe.get_doc("Mood", merge_into)
        if not any(_normalise(a.alias) == doc.normalised_name for a in mood.aliases):
            mood.append("aliases", {"alias": doc.suggested_name})
            mood.save(ignore_permissions=True)
        doc.status = "Merged"
        doc.merged_into = merge_into
    else:
        mood = frappe.get_doc(
            {"doctype": "Mood", "mood_name": mood_name or doc.suggested_name}
        ).insert(ignore_permissions=True)
        doc.status = "Approved"
        doc.merged_into = mood.name

    doc.save(ignore_permissions=True)

    # Light up every venue that was waiting on this suggestion. Approving the
    # word without moving the venues would leave each partner needing to come
    # back and re-edit — which none of them will do.
    promoted = _promote_venue_moods(doc.name, doc.merged_into)

    frappe.db.commit()
    return {"mood": doc.merged_into, "venues_updated": promoted}


# ---------------------------------------------------------------------------
# Doctypes required
# ---------------------------------------------------------------------------
#
# Mood Alias  (child table, parent = Mood, fieldname `aliases`)
#   alias : Data, reqd
#
#   Add to the existing `Mood` doctype as a Table field named `aliases`.
#   Seed from src/services/mockBackend.js, which already carries a working alias
#   set drawn from the design frames.
#
# Mood Suggestion
#   suggested_name  : Data, reqd              -- exactly as the partner typed it
#   normalised_name : Data, reqd, unique-ish  -- _normalise() output; dedupes
#   status          : Select — Pending Review / Approved / Merged / Rejected
#   vendor_profile  : Link → Vendor Profile   -- who asked, so they can be told
#   merged_into     : Link → Mood             -- set on approve/merge
#
#   Then build the Desk list view with "Merge into…" and "Approve as new"
#   actions calling approve_mood_suggestion() above. Sort it by
#   `request_count desc` — see get_mood_demand().
#
#   request_count : Int, read-only            -- distinct vendors who asked
#   requesters    : Table → Mood Suggestion Requester
#
# Mood Suggestion Requester  (child table, parent = Mood Suggestion,
#                             fieldname `requesters`)
#   vendor_profile : Link → Vendor Profile, reqd
#
# Venue Mood — add one field so a venue can hold a mood that is not canonical
# YET:
#   mood_suggestion : Link → Mood Suggestion, optional
#
#   `mood` stays required-ish but must become optional, with a validation that
#   exactly one of (mood, mood_suggestion) is set.


# ---------------------------------------------------------------------------
# create_venue: accepting a not-yet-approved mood
# ---------------------------------------------------------------------------
#
# This is the piece that makes vendor-authored moods worth having. Merge into
# the existing `create_venue` where it builds the Venue Mood rows.
#
# Without it, approving a suggestion fixes the vocabulary but not the venues
# that asked for it — every partner who requested the mood would have to come
# back and re-edit their venue, which none of them will do, so the approval
# achieves nothing user-visible.


def _attach_moods(venue_doc, moods):
    """Attach a mixed list of canonical Moods and Mood Suggestions to a venue.

    `moods` items may be:
      - a Mood docname or its `mood_name`   -> linked canonically
      - a Mood Suggestion docname            -> parked on the row until approved

    A parked mood is invisible to customer search until staff approve it, which
    is correct: unreviewed vendor text must not become a search facet. But the
    LINK is recorded now, so `approve_mood_suggestion` can light up every venue
    waiting on it in one action.
    """
    venue_doc.set("moods", [])

    for entry in moods or []:
        entry = (entry or "").strip()
        if not entry:
            continue

        mood = frappe.db.get_value("Mood", entry, "name") or frappe.db.get_value(
            "Mood", {"mood_name": entry}, "name"
        )
        if mood:
            venue_doc.append("moods", {"mood": mood})
            continue

        if frappe.db.exists("Mood Suggestion", entry):
            venue_doc.append("moods", {"mood_suggestion": entry})
            continue

        # Neither a Mood nor a Suggestion. Refuse loudly rather than dropping it:
        # a silently discarded mood is how a venue ends up never appearing in
        # the search its owner expected.
        frappe.throw(f"Unknown mood: {entry}")


def _promote_venue_moods(suggestion, mood):
    """Rewrite parked rows onto the real Mood once a suggestion is approved.

    Call from `approve_mood_suggestion` after it sets `merged_into`. This is
    the payoff for recording the link at submit time.
    """
    rows = frappe.get_all(
        "Venue Mood", filters={"mood_suggestion": suggestion}, fields=["name", "parent"]
    )
    for row in rows:
        # Skip if the venue already carries the canonical mood — merging a
        # suggestion into an existing Mood can otherwise produce a duplicate
        # row on a venue that had both.
        if frappe.db.exists("Venue Mood", {"parent": row.parent, "mood": mood}):
            frappe.delete_doc("Venue Mood", row.name, ignore_permissions=True, force=True)
            continue
        frappe.db.set_value("Venue Mood", row.name, {"mood": mood, "mood_suggestion": None})

    frappe.db.commit()
    return len(rows)

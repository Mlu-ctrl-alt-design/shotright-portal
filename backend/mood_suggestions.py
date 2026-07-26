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
    else:
        doc = frappe.get_doc(
            {
                "doctype": "Mood Suggestion",
                "suggested_name": (text or "").strip(),
                "normalised_name": key,
                "status": "Pending Review",
                "vendor_profile": vendor,
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
    frappe.db.commit()
    return {"mood": doc.merged_into}


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
#   actions calling approve_mood_suggestion() above.
#
# Also worth doing while here: `create_venue` should accept a Mood Suggestion in
# its `moods` array and store it on the Venue Mood child row, so a venue keeps
# the link and starts appearing in search the moment the suggestion is approved.
# Without that, approving a suggestion fixes the vocabulary but not the venues
# that asked for it.

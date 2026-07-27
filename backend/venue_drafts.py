"""
Resumable venue setup — "Pick up where you left off".

DROP-IN: paste these four methods into `shotright/api.py` (the flat
`shotright.api.*` namespace the app already uses) and create the `Venue Draft`
doctype described at the bottom.

Full spec, including the copy that depends on this and the two open decisions:
`docs/RESUME-SETUP.md`.

Why this exists
---------------
The venue wizard asks for a name, a manager, an address, a map pin, a mood set,
three time ranges and a whole menu. That is not a form anyone finishes between
two customers. Today, putting it down loses everything — and the attempt people
abandon is the second one, not the first.

The portal already autosaves and already shows a resume card. Right now the
draft lives in the partner's `localStorage`, which survives a reload and a closed
tab but not a different device, a cleared cache, or a private window. Because of
that the portal is currently showing the honest, smaller promise ("Saved in this
browser") instead of the designed one ("Nothing expires — and we emailed you this
link too"). Deploying these four methods is what makes the designed promise true;
the frontend switches over on its own, with no release, because `withFallback`
treats a 404 as "not deployed" and nothing else.

The one thing that will silently break this
-------------------------------------------
`frappe.call()` DROPS kwargs that are not in the declared signature — at HTTP
200, with no error. Three separate bugs on this project came from exactly that.
If a parameter below is renamed or dropped, the portal will appear to save and
will save nothing, and nobody finds out until a partner loses an evening's work.
Keep the names, or tell the frontend what they actually are.

`payload` is opaque
-------------------
`payload` is JSON the portal writes and reads. Store and return it byte-for-byte;
do not parse, validate or migrate it. That is the whole point: adding a field to
the wizard stays a frontend change. `step`, `completed` and `venue_name` are
lifted out into real columns only because the listing has to sort and display
them without loading the blob.
"""

import json

import frappe

STEPS = ("mood", "details", "hours", "menu", "review")


def _vendor() -> str:
    """The calling session's Vendor Profile, or 403.

    Resolved from the session, never from a parameter. A draft holds an address
    and a phone number, so a draft_id that reaches across accounts is a real
    disclosure — the same reason the venue endpoints already work this way.
    """
    vendor = frappe.db.get_value("Vendor Profile", {"user": frappe.session.user}, "name")
    if not vendor:
        frappe.throw("No vendor profile for this account.", frappe.PermissionError)
    return vendor


def _owned(draft_id: str):
    """Load a draft the caller owns, or 404.

    Deliberately 404 and not 403 on someone else's draft: telling an attacker
    "that exists but is not yours" is itself a disclosure, and the portal renders
    both the same way anyway ("we couldn't find that saved setup").
    """
    doc = frappe.db.exists("Venue Draft", {"name": draft_id, "vendor": _vendor()})
    if not doc:
        frappe.throw("That saved setup no longer exists.", frappe.DoesNotExistError)
    return frappe.get_doc("Venue Draft", draft_id)


def _as_dict(doc, with_payload: bool = True) -> dict:
    out = {
        "draft_id": doc.name,
        "step": doc.step or STEPS[0],
        # Stored as JSON text, returned as a real array — the portal should not
        # have to know how we chose to serialise it.
        "completed": json.loads(doc.completed or "[]"),
        "venue_name": doc.venue_name or "",
        "modified": str(doc.modified),
    }
    if with_payload:
        out["payload"] = json.loads(doc.payload or "{}")
    return out


@frappe.whitelist()
def save_venue_draft(step, payload, draft_id=None, completed=None, venue_name=None):
    """Create or update a draft. Returns the saved draft, payload included.

    The portal SHOWS what this returns — an autosave indicator that reads "Saved"
    when the write failed is worse than no indicator, because it talks a partner
    out of the caution that would have protected them. So this must throw on
    failure rather than returning a partial success.
    """
    if step not in STEPS:
        frappe.throw(f"Unknown setup step: {step}")

    # Validated as JSON, then stored as the ORIGINAL TEXT. Round-tripping through
    # Python would silently reorder keys and reformat numbers, and the portal
    # compares payloads to decide whether anything changed.
    try:
        json.loads(payload)
    except (TypeError, ValueError):
        frappe.throw("Draft payload must be JSON.")

    doc = _owned(draft_id) if draft_id else frappe.new_doc("Venue Draft")
    if not draft_id:
        doc.vendor = _vendor()

    doc.step = step
    doc.completed = completed or "[]"
    doc.venue_name = (venue_name or "")[:140]
    doc.payload = payload
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return _as_dict(doc)


@frappe.whitelist()
def list_venue_drafts():
    """The caller's unfinished setups, newest first, WITHOUT payload.

    The dashboard needs a summary, not 200KB of menu JSON per draft — and it
    fetches this on every visit.
    """
    rows = frappe.get_all(
        "Venue Draft",
        filters={"vendor": _vendor()},
        fields=["name as draft_id", "step", "completed", "venue_name", "modified"],
        order_by="modified desc",
        limit_page_length=20,
    )
    for row in rows:
        row["completed"] = json.loads(row.get("completed") or "[]")
        row["modified"] = str(row["modified"])
    return rows


@frappe.whitelist()
def get_venue_draft(draft_id):
    """One draft in full. 404 if it is missing or not the caller's."""
    return _as_dict(_owned(draft_id))


@frappe.whitelist()
def discard_venue_draft(draft_id):
    """Delete a draft.

    Called both when a partner gives up on one and — importantly — the moment
    its venue is successfully created. Leaving it behind would put "continue
    setup" on the dashboard beside the venue it already produced, and a partner
    would reasonably do both and list the place twice.
    """
    doc = _owned(draft_id)
    frappe.delete_doc("Venue Draft", doc.name, ignore_permissions=True, force=True)
    frappe.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# DOCTYPE: Venue Draft
#
#   vendor      Link → Vendor Profile   (reqd, index; every read filters on it)
#   step        Data                    (reqd)
#   completed   Small Text              (JSON array of step keys)
#   venue_name  Data                    (for the dashboard listing)
#   payload     Long Text               (opaque JSON — see the module docstring)
#
# Naming: hash or a VD-##### series, either is fine — the portal treats
# `draft_id` as an opaque string and puts it in a URL, so it must be URL-safe.
#
# Permissions: Vendor role, read/write/delete on OWN rows only. All four methods
# above already enforce ownership themselves, so the doctype permissions are the
# second lock rather than the only one.
#
# Retention: the portal's resume card currently says "nothing expires". If there
# is a cleanup job, say so and the copy changes — printing "nothing expires" over
# a row with a 30-day TTL is exactly the kind of confident lie this codebase
# keeps refusing to ship.
#
# STILL NEEDED, and not in this file (see docs/RESUME-SETUP.md §6a): the resume
# EMAIL. Suggested trigger is a daily job over drafts untouched for 24h that are
# past step 1, one email per draft ever — not a nightly nudge. Until it exists
# the portal does not claim to have sent one.
# ---------------------------------------------------------------------------

"""
What the moderator said — so a declined partner can act on it.

DROP-IN: paste these into `shotright/api.py`, add four fields to `Venue`, and
add the `Venue Fix Item` child table described at the bottom.

Why this exists
---------------
A decline is the only moment in this product where the partner is not the one
driving. They filled in a long form, submitted a venue, waited days, and were
told no by somebody they have never spoken to.

Right now the portal can tell them THAT and nothing else, because the decision
is a workflow state and nothing more. There is no field for a moderator to
write into, so there is no reason to show. The new review screen therefore has
to say, in as many words, "no reason was recorded" — which is honest, and is a
bad thing for a business owner to read about their own livelihood.

What we are NOT doing while we wait
-----------------------------------
Not filling the gap with a generic line. "Your venue didn't meet our
guidelines" would remove the awkwardness and replace it with something worse: a
partner acts on it, changes the wrong thing, resubmits, and is declined again —
and now they have also learned that the portal's explanations are not worth
reading. An admitted absence is recoverable. An invented reason is not.

What the screen already does without you
----------------------------------------
It derives what it can see for itself — no map pin, no photos, nothing on the
menu, no description — and shows it under its own heading, explicitly labelled
as *our* observation and not the reviewer's. Those are the common decline
reasons and they are checkable from data the portal already holds. It is a
decent consolation prize. It is not a substitute for the moderator's actual
sentence, because the reviewer may have declined the venue for something no
amount of client-side checking can see.

The one thing that will silently break this
-------------------------------------------
`frappe.call()` DROPS kwargs that are not in the declared signature — at HTTP
200, with no error. Three separate bugs on this project came from exactly that.
Keep `venue_name`, `item` and `done` as written, or tell the frontend what they
actually are.

Two things worth doing in the Desk, not here
--------------------------------------------
1. Make `review_notes` REQUIRED on the decline transition. A decline with an
   empty note is the thing this whole file exists to prevent, and a workflow
   that permits it will produce it.
2. Show the vendor's own words back to the moderator. Most declines are a
   misunderstanding in one direction or the other.
"""

import frappe
from frappe import _


def _vendor():
    """The Vendor Profile for the current session, or 403."""
    vendor = frappe.db.get_value("Vendor Profile", {"user": frappe.session.user}, "name")
    if not vendor:
        frappe.throw(_("No vendor profile for this account."), frappe.PermissionError)
    return vendor


def _owned(venue_name):
    """The Venue if it belongs to the caller, else 404 (not 403 — see below).

    404 rather than 403 on someone else's venue: a 403 confirms the venue
    exists, which turns this endpoint into a directory of every business on the
    platform for anyone willing to iterate names.
    """
    venue = frappe.db.get_value("Venue", venue_name, ["name", "vendor"], as_dict=True)
    if not venue or venue.vendor != _vendor():
        frappe.throw(_("Venue not found."), frappe.DoesNotExistError)
    return venue


@frappe.whitelist()
def get_venue_review(venue_name):
    """The current decision on a venue, and what the reviewer asked for.

    Returns:

        {
          "state":          "Declined",
          "notes":          "<the moderator's own words, plain text>",
          "reviewed_by":    "nandi@shotright.co.za",
          "reviewed_by_name": "Nandi M.",
          "reviewed_on":    "2026-07-25 14:02:11",
          "fix_items": [ {"name": "abc123", "label": "Drop the pin on the venue",
                          "done": 0}, ... ]
        }

    `notes` is shown to the partner VERBATIM, in a quote block, attributed to
    the reviewer. Write it as a message to a business owner rather than as an
    internal moderation note — it is not summarised, softened or reformatted on
    the way through, deliberately, because the partner came to the page to read
    exactly what was said.

    PLAIN TEXT, not HTML. It renders with `white-space: pre-line`, so newlines
    survive and nothing else is interpreted. Sending HTML here would either be
    escaped and shown as tags, or become an injection route into the partner's
    browser — neither is what anyone wants.

    Returning `None` is legitimate and handled: the screen says no reason was
    recorded rather than inventing one.
    """
    venue = _owned(venue_name)
    doc = frappe.get_doc("Venue", venue.name)

    if not (doc.get("review_notes") or doc.get("reviewed_on")):
        return None

    reviewer = doc.get("reviewed_by")

    return {
        "state": doc.get("workflow_state"),
        "notes": doc.get("review_notes") or "",
        "reviewed_by": reviewer,
        # The person, not the login. "Nandi M." reads as a human being having
        # looked at your restaurant; "nandi@shotright.co.za" reads as a system.
        "reviewed_by_name": frappe.db.get_value("User", reviewer, "full_name") if reviewer else None,
        "reviewed_on": doc.get("reviewed_on"),
        "fix_items": [
            {"name": row.name, "label": row.label, "done": int(row.done or 0)}
            for row in (doc.get("fix_items") or [])
        ],
    }


@frappe.whitelist()
def set_review_fix_item(venue_name, item, done):
    """Tick one fix item off.

    This is the PARTNER'S working memory, not a report to the reviewer, and the
    portal says so on screen. Do not wire it to a notification, and do not let
    it affect the workflow state — a partner who believes ticking a box has told
    somebody they fixed it will sit waiting for a reply that is not coming.

    Falls back to the partner's own browser when this method is absent, so the
    checklist works either way; deploying this just makes it follow them to
    another device.
    """
    venue = _owned(venue_name)
    row = frappe.db.get_value(
        "Venue Fix Item", {"name": item, "parent": venue.name}, "name"
    )
    if not row:
        frappe.throw(_("That item is not on this venue."), frappe.DoesNotExistError)

    frappe.db.set_value("Venue Fix Item", row, "done", 1 if int(done or 0) else 0)
    frappe.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# DOCTYPES
# ---------------------------------------------------------------------------
#
# On "Venue", add:
#
#   review_notes   Small Text   What the moderator wants to say to the partner.
#                               PLAIN TEXT. ⚠️ Make this REQUIRED on the decline
#                               transition — see the note at the top.
#   reviewed_by    Link → User  Set by the workflow, read-only.
#   reviewed_on    Datetime     Set by the workflow, read-only.
#   fix_items      Table → Venue Fix Item
#
# Child table: "Venue Fix Item"  (istable = 1)
#
#   label   Data    One thing to change, phrased as an instruction the partner
#                   can act on: "Drop the pin on the venue", not "location".
#   done    Check   Ticked by the PARTNER, not the moderator.
#
# PERMISSIONS
#
#   The Vendor role needs no direct permission on any of this — both methods
#   resolve ownership from the session. `review_notes` must NOT be vendor-
#   writable: it is the reviewer's statement, and a partner able to edit it
#   would make the record useless to both of them.
#
# THE DECISION WE NEED FROM YOU
#
#   Does resubmitting EDIT THE VENUE, or restore a DRAFT?
#
#   We think editing the Venue is right: the review history hangs off it, the
#   partner keeps one thing with one identity, and "edit and resubmit" is one
#   action rather than a copy that has to be reconciled later. The portal is
#   built that way — the button on the review screen goes to the venue's own
#   edit form.
#
#   If you would rather it became a Draft again, `save_venue_draft` needs a
#   `venue` link field so the two can be reconnected, and the review screen's
#   button changes. Tell us before you build it either way, because those are
#   different products and only one of them matches what is shipped.
#
# AND ONE SMALL ONE
#
#   `reviewed_on` is rendered as a date, not a timestamp. If your workflow
#   stamps it on every save rather than only on a decision, it will read as
#   though someone reviewed the venue again today. Stamp it on the transition.

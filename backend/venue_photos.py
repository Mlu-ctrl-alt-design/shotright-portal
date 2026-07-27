"""
Venue photographs — the pictures a customer actually looks at.

DROP-IN: paste these three methods into `shotright/api.py` (the flat
`shotright.api.*` namespace the app already uses), add the `Venue Photo` child
table described at the bottom, and add one field to `Venue`.

Why this exists
---------------
Sho't Right sells a MOOD. A customer opens the app on a Friday, picks a feeling,
and gets a list of places. A listing with no picture is asking someone to choose
where to spend their evening on the strength of a name and a dress code.

Until now the partner portal had nowhere to upload a venue photo at all. Not a
broken feature — an absent one. A partner could set a map pin, pick six moods,
enter a full menu with a photo per dish, write three paragraphs about their
room, and still leave a customer with nothing to look at.

The portal now has the whole UI: choose or drag several at once, downscaled in
the browser (a 5 MB phone photo goes up as ~300 KB), reorder, pick the cover,
remove. What it does not have is anywhere to put the result.

What happens without this
-------------------------
The upload half already works on stock Frappe: the portal posts to
`upload_file` with `doctype=Venue` and `docname=<venue>`, so photos land as
attachments on the Venue and a moderator can see them in Desk. That is real, and
it is why the portal uploads regardless.

What is missing is a HOME and an ORDER. Attachments have no sequence and no
cover flag, and the customer app has no field to read. So the portal currently
tells the partner the truth — "these upload and our reviewers see them, but they
won't appear in search yet, and the order isn't saved" — and will stop saying it
the moment these methods answer. `withFallback` treats a 404 as "not deployed"
and nothing else, so this turns itself on with no frontend release.

Order is data, not decoration
-----------------------------
Photo 1 is the image on the search result card. A partner who drags their best
shot to the front has made an editorial decision about how their business is
presented. Storing an unordered set throws that away, and there is no way for
them to tell that it happened.

The one thing that will silently break this
-------------------------------------------
`frappe.call()` DROPS kwargs that are not in the declared signature — at HTTP
200, with no error. Three separate bugs on this project came from exactly that.
If `venue_name` or `photos` is renamed here, the portal will appear to save and
will save nothing. Keep the names, or tell the frontend what they are.

Files, not copies
-----------------
`photos` rows carry the File docname the portal already created. Link to it —
do not re-upload, re-encode or move the bytes. The File exists, it is public,
and its `file_url` is already on screen in the partner's browser.
"""

import json

import frappe
from frappe import _

MAX_PHOTOS = 10

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp", ".avif")


def _vendor():
    """The Vendor Profile for the current session, or 403.

    Resolved from the session, NEVER from a parameter. A venue's photo set is
    not sensitive in itself, but "which venue" must not be something the caller
    can assert.
    """
    vendor = frappe.db.get_value(
        "Vendor Profile", {"user": frappe.session.user}, "name"
    )
    if not vendor:
        frappe.throw(_("No vendor profile for this account."), frappe.PermissionError)
    return vendor


def _owned(venue_name):
    """Return the Venue if it belongs to the caller, else 404.

    404 rather than 403 on someone else's venue, deliberately: a 403 confirms
    the venue exists, which is a small directory of every business on the
    platform for anyone willing to iterate names.
    """
    venue = frappe.db.get_value(
        "Venue", venue_name, ["name", "vendor"], as_dict=True
    )
    if not venue or venue.vendor != _vendor():
        frappe.throw(_("Venue not found."), frappe.DoesNotExistError)
    return venue


@frappe.whitelist()
def set_venue_photos(venue_name, photos):
    """Replace a venue's photo set, in order.

    photos: a JSON array (or already-decoded list) of rows shaped

        {"file": "<File docname>", "file_url": "/files/front-bar.jpg",
         "file_name": "front-bar.jpg", "idx": 1, "is_cover": true}

    `idx` is 1-based and is the order the partner chose. `is_cover` is true on
    the first row only and is derived, not independent — it is sent so the
    reader does not have to know that rule.

    Whole-set replace rather than add/remove/reorder endpoints: reordering is
    the common edit, and three round-trips to move one photo left is both
    slower and racier than one call that states the final answer.
    """
    venue = _owned(venue_name)

    if isinstance(photos, str):
        photos = json.loads(photos or "[]")
    if not isinstance(photos, list):
        frappe.throw(_("photos must be a list."))
    if len(photos) > MAX_PHOTOS:
        frappe.throw(_("A venue can have at most {0} photos.").format(MAX_PHOTOS))

    doc = frappe.get_doc("Venue", venue.name)
    doc.set("photos", [])

    for index, row in enumerate(photos):
        file_url = (row or {}).get("file_url")
        file_name = (row or {}).get("file")

        if not file_url:
            frappe.throw(_("A photo row is missing its file_url."))
        if not file_url.lower().endswith(IMAGE_SUFFIXES):
            frappe.throw(_("{0} is not an image.").format(file_url))

        # The File must exist and must be one of ours. Without this check a
        # caller could point a venue's cover at any URL on the bench,
        # including a private file belonging to someone else.
        file_doc = None
        if file_name:
            file_doc = frappe.db.get_value(
                "File", file_name, ["name", "file_url", "is_private", "owner"], as_dict=True
            )
        if not file_doc:
            file_doc = frappe.db.get_value(
                "File", {"file_url": file_url}, ["name", "file_url", "is_private", "owner"], as_dict=True
            )
        if not file_doc:
            frappe.throw(_("That photo is no longer on the server. Please upload it again."))
        if file_doc.owner != frappe.session.user:
            frappe.throw(_("That photo belongs to another account."), frappe.PermissionError)
        if file_doc.is_private:
            # Customers have to be able to load it. The portal uploads with
            # is_private=0; this catches anything that got in another way.
            frappe.db.set_value("File", file_doc.name, "is_private", 0)

        # Attach to the Venue so the photo travels with the document — a File
        # with no parent is the first thing a cleanup job deletes.
        frappe.db.set_value(
            "File",
            file_doc.name,
            {"attached_to_doctype": "Venue", "attached_to_name": venue.name},
            update_modified=False,
        )

        doc.append(
            "photos",
            {
                "file": file_doc.name,
                "image": file_doc.file_url,
                "file_name": (row or {}).get("file_name") or file_doc.file_url.split("/")[-1],
                "is_cover": 1 if index == 0 else 0,
            },
        )

    # The cover is denormalised onto the Venue so the customer app's search
    # results do not have to load a child table per result just to draw a card.
    doc.cover_image = doc.photos[0].image if doc.photos else None

    # Editing a venue sends it back for review, and photos are part of what is
    # reviewed. Left to the existing workflow rather than set here — see the
    # note in the doctype block below.
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return get_venue_photos(venue.name)


@frappe.whitelist(allow_guest=False)
def get_venue_photos(venue_name):
    """A venue's photos, in the partner's order, cover first.

    Returns a list of {file, file_url, file_name, idx, is_cover}. The names
    match what `set_venue_photos` accepts, so the portal round-trips one shape.

    NOTE FOR THE CUSTOMER APP: `find_venues` should return `cover_image` on
    each result. This endpoint is the partner's view of the gallery; a search
    result does not need the whole set.
    """
    venue = _owned(venue_name)
    doc = frappe.get_doc("Venue", venue.name)

    return [
        {
            "file": row.file,
            "file_url": row.image,
            "file_name": row.file_name,
            "idx": index + 1,
            "is_cover": bool(row.is_cover),
        }
        for index, row in enumerate(doc.get("photos") or [])
    ]


@frappe.whitelist()
def delete_venue_photo(venue_name, file):
    """Remove one photo and delete the File behind it.

    The portal does not call this — it sends the whole set through
    `set_venue_photos` — but a photo removed from a venue and left on disk is
    an orphaned public URL of the inside of someone's business, which is worth
    a method of its own for any cleanup that comes later.
    """
    venue = _owned(venue_name)
    doc = frappe.get_doc("Venue", venue.name)
    doc.set("photos", [row for row in (doc.get("photos") or []) if row.file != file])
    doc.cover_image = doc.photos[0].image if doc.photos else None
    doc.save(ignore_permissions=True)

    if frappe.db.exists("File", file):
        frappe.delete_doc("File", file, ignore_permissions=True, delete_permanently=True)

    frappe.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# DOCTYPES
# ---------------------------------------------------------------------------
#
# Child table: "Venue Photo"   (is_child_table = 1, istable = 1)
#
#   file        Link → File      required.  The File docname. Link, not Data,
#                                so deleting the File cannot leave a row
#                                pointing at nothing.
#   image       Attach Image     required.  The servable URL. Denormalised from
#                                File.file_url so reading the gallery is one
#                                query rather than one per photo.
#   file_name   Data                        The partner's own filename. Used as
#                                alt text in the portal — "front-bar.jpg" tells
#                                someone which photo failed; "photo 3" doesn't.
#   is_cover    Check                       True on idx 1 only. Derived, stored
#                                so a reader need not know the rule.
#
#   The row order IS the partner's order — Frappe keeps `idx` on child rows, so
#   nothing extra is needed for sequencing.
#
# On "Venue", add:
#
#   photos        Table → Venue Photo
#   cover_image   Attach Image, read_only   Denormalised photos[0].image, so a
#                                           search result card is one row.
#
# PERMISSIONS
#
#   The Vendor role needs read + write on File (it already uploads menu item
#   images, so this is likely already true). It does NOT need direct write on
#   Venue Photo — everything goes through these methods, which resolve
#   ownership from the session.
#
# ONE DECISION FOR YOU
#
#   Does changing a venue's photos send it back for review?
#
#   Editing a venue currently does. Photos are the most user-visible thing on a
#   listing and the easiest to abuse, so the same rule probably applies — but a
#   partner reordering two existing, already-approved photos being knocked out
#   of search for a day is a bad trade.
#
#   Our suggestion: ADDING or REPLACING a photo re-enters review; REORDERING an
#   already-approved set does not. `set_venue_photos` has both the old and new
#   sets in hand and can tell the difference. Tell us which way you go and the
#   portal will say so on the button, because "Save" and "Save and resubmit for
#   review" are not the same promise.

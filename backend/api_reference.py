"""
Reference implementation of the Vendor Portal's server surface.

This is the contract `frontend/src/services/vendor.js` is written against.
Split into `shotright/api/auth.py` and `shotright/api/vendor.py` when the app
is scaffolded (#2); it lives as one file here only so the portal repo carries
a single readable spec.

Ownership rule that runs through every endpoint: a vendor may only ever read or
write records reachable from *their own* Vendor Profile. Never trust a
`venue_id` from the client without re-resolving it through the session.
"""

import json

import frappe
from frappe import _


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _get_session_vendor():
    """Resolve the logged-in user to their Vendor Profile, or refuse.

    This is the single choke point for authorisation. Every authenticated
    endpoint starts here.
    """
    if frappe.session.user == "Guest":
        frappe.throw(_("Please sign in."), frappe.AuthenticationError)

    vendor = frappe.db.get_value("Vendor Profile", {"user": frappe.session.user}, "name")
    if not vendor:
        # A User with no Vendor Profile is not an error state per #14 — they may
        # hold only a Customer Profile. It is simply not a portal session.
        frappe.throw(_("No vendor profile linked to this account."), frappe.PermissionError)
    return vendor


def _assert_owns_venue(venue_id, vendor=None):
    """Confirm this vendor owns `venue_id`. Returns the vendor name."""
    vendor = vendor or _get_session_vendor()
    owner = frappe.db.get_value("Venue", venue_id, "vendor_profile")
    if owner != vendor:
        frappe.throw(_("You do not have access to this venue."), frappe.PermissionError)
    return vendor


def _serialize_venue(doc):
    return {
        "name": doc.name,
        "venue_name": doc.venue_name,
        "workflow_state": doc.workflow_state,
        "address": doc.address,
        "latitude": doc.latitude,
        "longitude": doc.longitude,
        "dress_code": doc.dress_code,
        "atmosphere_desc": doc.atmosphere_desc,
        "moods": [row.mood for row in doc.get("moods", [])],
        "operating_hours": [
            {
                "day_of_week": row.day_of_week,
                "open_time": str(row.open_time)[:5] if row.open_time else "",
                "close_time": str(row.close_time)[:5] if row.close_time else "",
                "closed": bool(row.closed),
            }
            for row in doc.get("operating_hours", [])
        ],
    }


def _apply_venue_payload(doc, payload):
    """Copy client-supplied fields onto a Venue doc.

    Deliberately field-by-field: `workflow_state` and `vendor_profile` are set
    by the server and must never be assignable from the request body.
    """
    for field in ("venue_name", "address", "latitude", "longitude", "dress_code", "atmosphere_desc"):
        if field in payload:
            doc.set(field, payload.get(field))

    moods = payload.get("moods") or []
    if isinstance(moods, str):
        moods = json.loads(moods)
    doc.set("moods", [])
    for mood in moods:
        # Moods are curated (#20) — reject anything not already in the master.
        if not frappe.db.exists("Mood", mood):
            frappe.throw(_("Unknown mood: {0}").format(mood))
        doc.append("moods", {"mood": mood})

    hours = payload.get("operating_hours") or []
    if isinstance(hours, str):
        hours = json.loads(hours)
    doc.set("operating_hours", [])
    for row in hours:
        doc.append(
            "operating_hours",
            {
                "day_of_week": row.get("day_of_week"),
                "open_time": row.get("open_time"),
                "close_time": row.get("close_time"),
                "closed": 1 if row.get("closed") else 0,
            },
        )
    return doc


# --------------------------------------------------------------------------
# auth  (#14)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_vendor_session():
    """Called on login and on every app boot to rehydrate the session.

    Returns the user, their Vendor Profile, and a CSRF token — a decoupled SPA
    is never served Frappe's HTML, so it cannot pick up `window.csrf_token`.
    """
    vendor = _get_session_vendor()
    profile = frappe.get_doc("Vendor Profile", vendor)
    user = frappe.get_doc("User", frappe.session.user)

    return {
        "user": {"email": user.name, "full_name": user.full_name},
        "vendor_profile": {
            "name": profile.name,
            "vendor_name": profile.vendor_name,
            "business_name": profile.business_name,
            "email": user.name,
            "phone": profile.phone,
        },
        "csrf_token": frappe.sessions.get_csrf_token(),
    }


@frappe.whitelist(allow_guest=True, methods=["POST"])
def register_vendor(email, password, vendor_name, business_name=None, phone=None):
    """Create a Website User + Vendor Profile and log them straight in.

    Per #14, an existing Customer Profile on this email must NOT block
    registration — we reuse the User record and only add the Vendor Profile.
    """
    if frappe.db.exists("Vendor Profile", {"user": email}):
        frappe.throw(_("A vendor account already exists for this email."))

    if frappe.db.exists("User", email):
        user = frappe.get_doc("User", email)
    else:
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": vendor_name,
                "send_welcome_email": 0,
                # Website User: portal access only, no Desk.
                "user_type": "Website User",
            }
        )
        user.insert(ignore_permissions=True)
        user.new_password = password
        user.save(ignore_permissions=True)

    profile = frappe.get_doc(
        {
            "doctype": "Vendor Profile",
            "user": user.name,
            "vendor_name": vendor_name,
            "business_name": business_name,
            "phone": phone,
        }
    )
    profile.insert(ignore_permissions=True)
    frappe.db.commit()

    frappe.local.login_manager.login_as(user.name)
    return get_vendor_session()


# --------------------------------------------------------------------------
# moods  (#20 — read-only from the portal)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_moods():
    _get_session_vendor()
    return frappe.get_all("Mood", fields=["name", "mood_name"], order_by="mood_name asc")


# --------------------------------------------------------------------------
# dashboard  (#18)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_dashboard():
    """Stat tiles + venue list + profile summary. No tier gating in this phase."""
    vendor = _get_session_vendor()
    profile = frappe.get_doc("Vendor Profile", vendor)

    venues = frappe.get_all(
        "Venue",
        filters={"vendor_profile": vendor},
        fields=["name", "venue_name", "workflow_state", "address"],
        order_by="modified desc",
    )

    def count(state):
        return sum(1 for v in venues if v.workflow_state == state)

    return {
        "profile": {
            "name": profile.name,
            "vendor_name": profile.vendor_name,
            "business_name": profile.business_name,
            "email": profile.user,
            "phone": profile.phone,
        },
        "stats": {
            "total": len(venues),
            "approved": count("Approved"),
            "pending": count("Pending"),
            "rejected": count("Rejected"),
        },
        "venues": venues,
    }


# --------------------------------------------------------------------------
# venues  (#15)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_my_venues():
    vendor = _get_session_vendor()
    names = frappe.get_all(
        "Venue", filters={"vendor_profile": vendor}, pluck="name", order_by="modified desc"
    )
    return [_serialize_venue(frappe.get_doc("Venue", name)) for name in names]


@frappe.whitelist()
def get_venue_detail(venue_id):
    _assert_owns_venue(venue_id)
    return _serialize_venue(frappe.get_doc("Venue", venue_id))


@frappe.whitelist(methods=["POST"])
def create_venue(**payload):
    """Create a Venue in one shot: details, moods and hours together (#15)."""
    vendor = _get_session_vendor()

    doc = frappe.new_doc("Venue")
    doc.vendor_profile = vendor
    # Every vendor-created venue enters review. Never client-supplied.
    doc.workflow_state = "Pending"
    _apply_venue_payload(doc, payload)
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return _serialize_venue(doc)


@frappe.whitelist(methods=["POST"])
def update_venue(venue_id, **payload):
    _assert_owns_venue(venue_id)

    doc = frappe.get_doc("Venue", venue_id)
    _apply_venue_payload(doc, payload)
    # An edited venue goes back through approval rather than silently staying live.
    doc.workflow_state = "Pending"
    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return _serialize_venue(doc)


# --------------------------------------------------------------------------
# products / menu  (#17)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_venue_menu(venue_id):
    _assert_owns_venue(venue_id)

    headings = frappe.get_all(
        "Product Heading",
        filters={"venue": venue_id},
        fields=["name", "heading", "idx"],
        order_by="idx asc",
    )
    for heading in headings:
        heading["items"] = frappe.get_all(
            "Product Item",
            filters={"product_heading": heading["name"]},
            fields=["name", "item_name", "price", "description"],
            order_by="item_name asc",
        )
    return headings


@frappe.whitelist(methods=["POST"])
def create_product_heading(venue_id, heading):
    _assert_owns_venue(venue_id)

    existing = frappe.db.count("Product Heading", {"venue": venue_id})
    doc = frappe.get_doc(
        {"doctype": "Product Heading", "venue": venue_id, "heading": heading, "idx": existing + 1}
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name, "venue": venue_id, "heading": doc.heading, "idx": doc.idx}


@frappe.whitelist(methods=["POST"])
def create_product_item(heading_id, item_name, price, description=None):
    # Ownership is checked through the heading's venue, not the heading itself.
    venue_id = frappe.db.get_value("Product Heading", heading_id, "venue")
    _assert_owns_venue(venue_id)

    doc = frappe.get_doc(
        {
            "doctype": "Product Item",
            "product_heading": heading_id,
            "item_name": item_name,
            "price": frappe.utils.flt(price),
            "description": description,
        }
    )
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {
        "name": doc.name,
        "product_heading": heading_id,
        "item_name": doc.item_name,
        "price": doc.price,
        "description": doc.description,
    }


@frappe.whitelist(methods=["POST"])
def delete_product_item(item_id):
    heading_id = frappe.db.get_value("Product Item", item_id, "product_heading")
    venue_id = frappe.db.get_value("Product Heading", heading_id, "venue")
    _assert_owns_venue(venue_id)

    frappe.delete_doc("Product Item", item_id, ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist(methods=["POST"])
def import_menu(venue_id, rows):
    """Bulk menu upload (#17).

    `rows` is a JSON array of {heading, item_name, price, description}. The
    client parses the CSV for fast feedback; this revalidates everything, since
    a client-side parse is not a trust boundary.
    """
    _assert_owns_venue(venue_id)

    if isinstance(rows, str):
        rows = json.loads(rows)

    created = 0
    heading_cache = {}

    for row in rows:
        heading_name = (row.get("heading") or "").strip()
        item_name = (row.get("item_name") or "").strip()
        if not heading_name or not item_name:
            frappe.throw(_("Every row needs a heading and an item name."))

        if heading_name not in heading_cache:
            existing = frappe.db.get_value(
                "Product Heading", {"venue": venue_id, "heading": heading_name}, "name"
            )
            if not existing:
                existing = create_product_heading(venue_id, heading_name)["name"]
            heading_cache[heading_name] = existing

        frappe.get_doc(
            {
                "doctype": "Product Item",
                "product_heading": heading_cache[heading_name],
                "item_name": item_name,
                "price": frappe.utils.flt(row.get("price")),
                "description": row.get("description"),
            }
        ).insert(ignore_permissions=True)
        created += 1

    frappe.db.commit()
    return {"created": created}


# --------------------------------------------------------------------------
# profile  (#19)
# --------------------------------------------------------------------------

@frappe.whitelist()
def get_my_profile():
    vendor = _get_session_vendor()
    profile = frappe.get_doc("Vendor Profile", vendor)
    return {
        "name": profile.name,
        "vendor_name": profile.vendor_name,
        "business_name": profile.business_name,
        "email": profile.user,
        "phone": profile.phone,
    }


@frappe.whitelist(methods=["POST"])
def update_my_profile(vendor_name=None, business_name=None, phone=None, new_password=None):
    """Update the logged-in vendor's own profile, and optionally their password.

    The password is handed to Frappe's User doc so it goes through the normal
    hashing and password-policy path — it is never written to Vendor Profile
    and never returned in the response.
    """
    vendor = _get_session_vendor()
    profile = frappe.get_doc("Vendor Profile", vendor)

    if vendor_name is not None:
        profile.vendor_name = vendor_name
    if business_name is not None:
        profile.business_name = business_name
    if phone is not None:
        profile.phone = phone
    profile.save(ignore_permissions=True)

    if new_password:
        user = frappe.get_doc("User", frappe.session.user)
        user.new_password = new_password
        user.save(ignore_permissions=True)

    frappe.db.commit()
    return get_my_profile()

"""
Background menu import.

Drop into `shotright/api/`. The portal detects it at runtime: until it exists,
the upload stays on the existing synchronous `import_products_from_excel` and
the UI adjusts what it promises accordingly. See "Shipping order" at the bottom.

WHY THIS IS A BACKGROUND JOB
-----------------------------
The product promise is "this takes about twenty seconds — you don't have to
wait, you can leave the page". That sentence is only true if the work does not
live in the browser's request.

Today `import_products_from_excel` runs inside the HTTP request. If the partner
closes the tab the response is lost, and whether the rows landed depends on
whether the worker happened to finish before the connection dropped. The portal
cannot report the outcome either way. Promising "you can leave" on top of that
would be a lie with a 50/50 chance of being caught.

Moving the parse to `frappe.enqueue` makes the promise true: the job owns the
work, the `Menu Import` doc owns the state, and the browser is just a viewer
that can come and go.

WHY A DOCTYPE AND NOT THE RQ JOB ID
------------------------------------
RQ job results expire, and the job id is meaningless after a restart. A partner
who uploads at 4pm and comes back the next morning should still be told what
happened. A doc also gives staff somewhere to look when someone asks why their
menu is short, and gives us per-row errors that survive.

DUPLICATES
----------
The partner is explicitly invited to start adding items by hand while the import
runs (that is the whole point of "you don't have to wait"), so the import WILL
sometimes race a manual entry for the same dish. Rows are matched on
(heading, item_name) case-insensitively and skipped rather than inserted, and
the skip count is reported. Silently creating "Chilli Poppers" twice is the
failure the partner would notice last and trust least.
"""

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

# Shown to the partner as "usually about N seconds". Deliberately a constant the
# UI reads rather than a number hard-coded in the copy — when the real
# distribution is known, change it here and the interface follows.
ESTIMATE_SECONDS = 20

# Above this, the UI stops saying "almost there" and offers the manual path.
SLOW_AFTER_SECONDS = 45


def _assert_owns_venue(venue_name):
    """A partner may only import into their own venue."""
    vendor = frappe.db.get_value("Vendor Profile", {"user": frappe.session.user}, "name")
    if not vendor:
        frappe.throw(_("No vendor profile linked to this account."), frappe.PermissionError)
    if frappe.db.get_value("Venue", venue_name, "vendor_profile") != vendor:
        frappe.throw(_("You do not have access to this venue."), frappe.PermissionError)
    return vendor


@frappe.whitelist(methods=["POST"])
def start_menu_import(venue_name, file_name):
    """Queue an import. Returns immediately with something to poll.

    `file_name` is the docname of a File already uploaded via `upload_file`.
    Splitting upload from parse is deliberate: the upload has a real progress
    bar the browser can show, and the parse does not, so conflating them would
    mean a progress bar that jumps to 100% and then sits there.
    """
    _assert_owns_venue(venue_name)

    job = frappe.get_doc(
        {
            "doctype": "Menu Import",
            "venue": venue_name,
            "file": file_name,
            "status": "Queued",
            # `stage` drives the checklist in the designs — "Found 4 categories",
            # "Reading 38 items and prices". A single percentage cannot say those
            # things, and they are what make the wait feel like work happening
            # rather than time passing.
            "stage": "uploaded",
            "processed": 0,
            "total": 0,
            "categories_found": 0,
            "created_count": 0,
            "skipped_count": 0,
        }
    ).insert(ignore_permissions=True)
    frappe.db.commit()

    frappe.enqueue(
        "shotright.api.menu_import.run_menu_import",
        queue="long",
        timeout=600,
        job_name=f"menu-import-{job.name}",
        import_name=job.name,
    )

    return {
        "name": job.name,
        "status": "Queued",
        "estimate_seconds": ESTIMATE_SECONDS,
        "slow_after_seconds": SLOW_AFTER_SECONDS,
    }


@frappe.whitelist()
def get_menu_import_status(name):
    """Poll target. Cheap on purpose — this is called every second or two."""
    job = frappe.db.get_value(
        "Menu Import",
        name,
        [
            "name",
            "venue",
            "status",
            "stage",
            "processed",
            "total",
            "categories_found",
            "missing_price_count",
            "created_count",
            "skipped_count",
            "error_message",
            "creation",
            "modified",
        ],
        as_dict=True,
    )
    if not job:
        frappe.throw(_("That import no longer exists."), frappe.DoesNotExistError)

    _assert_owns_venue(job.venue)

    job["errors"] = frappe.get_all(
        "Menu Import Row Error",
        filters={"parent": name},
        fields=["row_number", "message"],
        order_by="row_number asc",
        limit_page_length=50,
    )
    job["estimate_seconds"] = ESTIMATE_SECONDS
    job["slow_after_seconds"] = SLOW_AFTER_SECONDS
    return job


@frappe.whitelist(methods=["POST"])
def cancel_menu_import(name):
    """Stop reporting on an import the partner has given up on.

    Marks it Cancelled; the worker checks that flag between rows and stops.
    Rows already created are KEPT — deleting work the partner can see would be
    a worse surprise than a half-finished import they were told about.
    """
    job = frappe.get_doc("Menu Import", name)
    _assert_owns_venue(job.venue)

    if job.status in ("Completed", "Failed"):
        return {"status": job.status}

    job.status = "Cancelled"
    job.save(ignore_permissions=True)
    frappe.db.commit()
    return {"status": "Cancelled"}


def run_menu_import(import_name):
    """The worker. Never called directly by the portal."""
    job = frappe.get_doc("Menu Import", import_name)
    job.status = "Reading"
    job.stage = "scanning"
    job.save(ignore_permissions=True)
    frappe.db.commit()

    try:
        rows = _read_rows(job.file)

        # Publish the counts BEFORE importing. The checklist can then say "Found
        # 4 categories · Reading 38 items" while the work is still going, which
        # is the whole point of a staged wait — the partner sees that we
        # understood their file, not merely that we are busy.
        job.total = len(rows)
        job.categories_found = len({(r["heading"] or "").strip().lower() for r in rows if r["heading"]})
        job.stage = "reading"
        job.save(ignore_permissions=True)
        frappe.db.commit()

        created = skipped = 0
        for index, row in enumerate(rows, start=1):
            # Re-read only the status — cheap, and lets cancel take effect
            # between rows rather than after the whole file.
            if frappe.db.get_value("Menu Import", import_name, "status") == "Cancelled":
                break

            try:
                if _create_item(job.venue, row):
                    created += 1
                else:
                    skipped += 1
            except Exception as exc:
                job.append("errors", {"row_number": index + 1, "message": str(exc)})

            job.processed = index
            job.created_count = created
            job.skipped_count = skipped

            # Commit periodically rather than per row: the UI polls every second
            # or so, and a commit per row on a 500-row file is far more database
            # traffic than the progress bar is worth.
            if index % 10 == 0 or index == len(rows):
                job.save(ignore_permissions=True)
                frappe.db.commit()

        # Last stage in the designs' checklist. Rows with no price are not an
        # error — the partner may genuinely price on the day — but they ARE the
        # single most common reason a venue gets declined, so they are counted
        # and reported rather than waved through.
        job.stage = "checking"
        job.save(ignore_permissions=True)
        frappe.db.commit()
        job.missing_price_count = sum(1 for r in rows if not str(r.get("price") or "").strip())

        if job.status != "Cancelled":
            job.status = "Completed"
            job.stage = "done"
        job.finished_at = now_datetime()
        job.save(ignore_permissions=True)
        frappe.db.commit()

        # The designs promise "leave the page and we'll email you the moment
        # your menu is ready". That promise is the reason a partner walks away,
        # so the email is not a nicety — without it we have told them to stop
        # watching a thing that will never tell them it finished.
        if job.status == "Completed":
            _notify_menu_ready(job)

    except Exception:
        # A failure here must still reach the partner. Without this the doc
        # sits on "Reading" for ever and the UI shows a spinner that will
        # never resolve — the single worst outcome for a waiting state.
        job.reload()
        job.status = "Failed"
        job.stage = "failed"
        job.error_message = frappe.get_traceback(with_context=False)[-500:]
        job.finished_at = now_datetime()
        job.save(ignore_permissions=True)
        frappe.db.commit()
        frappe.log_error(title=f"shotright: menu import {import_name} failed")


def _notify_menu_ready(job):
    """Email the partner that their menu landed. Never raises."""
    try:
        vendor = frappe.db.get_value(
            "Vendor Profile",
            frappe.db.get_value("Venue", job.venue, "vendor_profile"),
            ["email", "vendor_name"],
            as_dict=True,
        )
        if not vendor or not vendor.email:
            return

        from shotright.api.otp_and_email import _send

        _send(
            vendor.email,
            _("Your menu is ready"),
            "shotright_menu_ready",
            {
                "first_name": (vendor.vendor_name or "").split(" ")[0] or _("there"),
                "venue_name": frappe.db.get_value("Venue", job.venue, "venue_name"),
                "created": job.created_count,
                "skipped": job.skipped_count,
                "missing_prices": job.missing_price_count,
            },
        )
    except Exception:
        frappe.log_error(title=f"shotright: menu-ready email failed for {job.name}")


def _read_rows(file_name):
    """Read the uploaded file into dicts.

    Uses Frappe's own reader, which handles .xlsx, .csv and .xls, so the portal
    can accept whatever a partner exports from Excel or Sheets without this file
    growing a spreadsheet parser.
    """
    from frappe.utils.file_manager import get_file_path
    from frappe.utils.xlsxutils import read_xlsx_file_from_attached_file
    import csv
    import io

    doc = frappe.get_doc("File", file_name)
    path = get_file_path(doc.file_url)

    if doc.file_name.lower().endswith((".xlsx", ".xls")):
        raw = read_xlsx_file_from_attached_file(file_url=doc.file_url)
    else:
        with open(path, newline="", encoding="utf-8-sig") as handle:
            raw = list(csv.reader(handle))

    if not raw:
        frappe.throw(_("That file is empty."))

    header = [str(h or "").strip().lower() for h in raw[0]]
    required = ["heading", "item_name", "price"]
    missing = [c for c in required if c not in header]
    if missing:
        frappe.throw(
            _("Missing column{0}: {1}. Expected: heading, item_name, price, description.").format(
                "s" if len(missing) > 1 else "", ", ".join(missing)
            )
        )

    index = {col: header.index(col) for col in header}
    rows = []
    for cells in raw[1:]:
        get = lambda col: str(cells[index[col]]).strip() if col in index and index[col] < len(cells) else ""
        if not any(str(c or "").strip() for c in cells):
            continue
        rows.append(
            {
                "heading": get("heading"),
                "item_name": get("item_name"),
                "price": get("price"),
                "description": get("description"),
            }
        )
    return rows


def _create_item(venue, row):
    """Create one item. Returns False if it already exists.

    Heading is created on demand — a partner should not have to pre-declare
    categories in the Desk before their own spreadsheet will import.
    """
    if not row["heading"] or not row["item_name"]:
        frappe.throw(_("heading and item_name are required"))

    price = str(row["price"]).replace("R", "").replace(",", "").strip()
    try:
        price = float(price or 0)
    except ValueError:
        frappe.throw(_("'{0}' is not a valid price").format(row["price"]))

    heading = frappe.db.get_value(
        "Product Heading", {"venue": venue, "heading_name": row["heading"]}, "name"
    )
    if not heading:
        heading = frappe.get_doc(
            {"doctype": "Product Heading", "venue": venue, "heading_name": row["heading"]}
        ).insert(ignore_permissions=True).name

    # Case-insensitive duplicate check — see the note at the top of this file.
    existing = frappe.db.sql(
        """SELECT name FROM `tabProduct Item`
           WHERE product_heading = %s AND LOWER(TRIM(item_name)) = %s LIMIT 1""",
        (heading, row["item_name"].strip().lower()),
    )
    if existing:
        return False

    frappe.get_doc(
        {
            "doctype": "Product Item",
            "product_heading": heading,
            "item_name": row["item_name"],
            "price": price,
            "description": row["description"],
        }
    ).insert(ignore_permissions=True)
    return True


# --------------------------------------------------------------------------
# DocTypes
#
# Menu Import
#   venue         : Link → Venue, reqd
#   file          : Link → File
#   status        : Select — Queued\nReading\nCompleted\nFailed\nCancelled
#   stage         : Select — uploaded\nscanning\nreading\nchecking\ndone\nfailed
#   processed     : Int
#   total         : Int
#   categories_found     : Int
#   missing_price_count  : Int
#   created_count : Int
#   skipped_count : Int
#   error_message : Small Text
#   finished_at   : Datetime
#   errors        : Table → Menu Import Row Error
#
# Menu Import Row Error  (child table)
#   row_number : Int
#   message    : Small Text
#
# Permissions: Vendor role needs READ on Menu Import (the portal polls it).
# Write happens server-side with ignore_permissions, so no write role is needed
# and none should be granted.
#
# --------------------------------------------------------------------------
# SHIPPING ORDER
#
# The portal detects this at runtime, so the two sides ship in either order:
#
#   Absent (today)   the upload uses the synchronous import_products_from_excel.
#                    The UI shows a waiting state but does NOT tell the partner
#                    they can leave — because they cannot, and saying so would
#                    be the lie this whole file exists to avoid.
#
#   Present          real background job. The UI says "about 20 seconds, you can
#                    leave this page", resumes on return, and offers the manual
#                    path once it runs long.
#
# Deploy: create the two doctypes, grant Vendor read on Menu Import, confirm a
# worker is consuming the `long` queue, then deploy this file.
# --------------------------------------------------------------------------

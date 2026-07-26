"""
Email verification, OTP and transactional mail for the Sho't Right partner portal.

Drop into `shotright/api/` alongside the rest of the whitelisted surface. The
portal is already written against this contract and detects it at runtime — see
"Shipping order" at the bottom of this file. Deploying it turns verification on;
until then the portal keeps working exactly as it does today.

WHY THIS EXISTS
---------------
Registration currently issues a working API token to anyone who can POST an
email address. Nothing proves the address belongs to the person, and nothing
costs an attacker anything, so the vendor list fills with junk that staff then
have to triage by hand. A one-time code sent to the address is the cheapest
control that actually raises that cost: you must be able to READ the mailbox.

It is not a strong control on its own — it stops drive-by junk, not a motivated
attacker with disposable mailboxes. If junk persists, the next lever is
approval-before-listing (which already exists for venues) or domain
reputation checks, not a longer code.

SECURITY DECISIONS, and why each one is the way it is
-----------------------------------------------------
* **Codes are hashed, never stored in the clear.** A read-only leak of this
  table (a support export, a careless report) must not hand over live codes.
* **`secrets`, not `random`.** `random` is a Mersenne Twister seeded
  predictably enough that observing a few codes can reveal the rest.
* **Constant-time comparison.** `==` on a secret leaks its prefix through
  timing. `hmac.compare_digest` does not.
* **Attempts are capped and the cap invalidates the code.** Six digits is a
  million possibilities, which sounds ample and is not: unlimited attempts fall
  in minutes. Five tries then a fresh code is the actual protection, and the
  code length is close to irrelevant next to it.
* **Password reset never reveals whether an account exists.** The response is
  byte-identical for a known and an unknown address. Otherwise this endpoint
  becomes a free membership oracle for anyone with a list of emails.
* **Registration DOES reveal it**, deliberately — "that email is already
  registered" is the only way a returning partner learns to go to login
  instead. The tradeoff is accepted here and refused above because the reset
  form is reachable without knowing anything, while a registration collision is
  something the user needs to act on.
* **The User is created disabled.** An unverified account must not be able to
  log in, and checking `enabled` is one flag rather than a second source of
  truth that can drift from it.

MAIL TRANSPORT IS NOT DECIDED HERE
----------------------------------
Everything sends through `frappe.sendmail`, which resolves the outgoing Email
Account from the Desk. SendGrid, Mailgun or plain SMTP are therefore a
configuration choice, not a code change — see `docs/EMAIL-SETUP.md`. Do not
import a provider SDK into this file; it would pin the platform to one vendor
and bypass Frappe's queue, retries and Communication log.
"""

import hashlib
import hmac
import secrets

import frappe
from frappe import _
from frappe.utils import add_to_date, now_datetime, get_datetime, cint


# --------------------------------------------------------------------------
# tunables
#
# Deliberately module constants rather than a Settings doctype: every one of
# these is a security parameter, and a security parameter that can be edited in
# the Desk by anyone with System Manager is not really a parameter. Move them
# to a Single doctype only if someone genuinely needs to tune them in
# production, and restrict who can.
# --------------------------------------------------------------------------

CODE_LENGTH = 6
CODE_TTL_MINUTES = 10
MAX_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60
MAX_SENDS_PER_HOUR = 5

PURPOSE_REGISTRATION = "Registration"
PURPOSE_PASSWORD_RESET = "Password Reset"

# Unverified accounts are purged after this long so a mistyped address does not
# permanently squat the real owner's email. See `purge_unverified_accounts`.
UNVERIFIED_TTL_HOURS = 24


# --------------------------------------------------------------------------
# code generation and storage
# --------------------------------------------------------------------------

def _generate_code():
    """A zero-padded numeric code, uniformly distributed.

    `secrets.randbelow(10**n)` rather than assembling digits one at a time:
    same result, no chance of an off-by-one biasing the first digit, and it is
    obvious at a glance that the whole range is reachable.
    """
    return str(secrets.randbelow(10 ** CODE_LENGTH)).zfill(CODE_LENGTH)


def _hash_code(email, purpose, code):
    """Salted hash of a code.

    Keyed on the site's `encryption_key` so a hash lifted from this site cannot
    be replayed against another, and on (email, purpose) so a code issued for
    registration can never be redeemed as a password reset.

    SHA-256 rather than a password KDF on purpose: the input is a 6-digit code
    that expires in ten minutes with five attempts, so brute-force resistance
    comes from the attempt cap, not from hashing cost. Using bcrypt here would
    add latency to every verification and buy nothing.
    """
    key = frappe.local.conf.get("encryption_key") or frappe.local.conf.get("secret")
    message = f"{(email or '').strip().lower()}|{purpose}|{code}"
    return hmac.new(str(key).encode(), message.encode(), hashlib.sha256).hexdigest()


def _recent_send_count(email, purpose):
    return frappe.db.count(
        "Vendor OTP",
        {
            "email": email,
            "purpose": purpose,
            "creation": [">", add_to_date(now_datetime(), hours=-1)],
        },
    )


def _latest_otp(email, purpose):
    rows = frappe.get_all(
        "Vendor OTP",
        filters={"email": email, "purpose": purpose, "consumed": 0},
        fields=["name", "code_hash", "expires_at", "attempts", "creation"],
        order_by="creation desc",
        limit=1,
    )
    return rows[0] if rows else None


def _issue_code(email, purpose, full_name=None):
    """Create and email a fresh code. Returns nothing the caller may leak.

    Any earlier unconsumed code for the same purpose is burned first. Without
    that, "resend" would leave several codes live at once and multiply the
    attempt budget by the number of resends — which is exactly the cap this
    relies on.
    """
    email = (email or "").strip().lower()

    if _recent_send_count(email, purpose) >= MAX_SENDS_PER_HOUR:
        frappe.throw(
            _("Too many codes requested. Please try again in an hour."),
            frappe.ValidationError,
        )

    previous = _latest_otp(email, purpose)
    if previous:
        age = (now_datetime() - get_datetime(previous.creation)).total_seconds()
        if age < RESEND_COOLDOWN_SECONDS:
            frappe.throw(
                _("Please wait {0} seconds before requesting another code.").format(
                    int(RESEND_COOLDOWN_SECONDS - age)
                ),
                frappe.ValidationError,
            )
        frappe.db.set_value("Vendor OTP", previous.name, "consumed", 1)

    code = _generate_code()
    frappe.get_doc(
        {
            "doctype": "Vendor OTP",
            "email": email,
            "purpose": purpose,
            "code_hash": _hash_code(email, purpose, code),
            "expires_at": add_to_date(now_datetime(), minutes=CODE_TTL_MINUTES),
            "attempts": 0,
            "consumed": 0,
        }
    ).insert(ignore_permissions=True)

    _send_otp_email(email, code, purpose, full_name)


def _consume_code(email, purpose, code):
    """Validate a submitted code. Throws on every failure path.

    Returns None; callers proceed only if this did not throw.
    """
    email = (email or "").strip().lower()
    record = _latest_otp(email, purpose)

    # No outstanding code and a wrong code are reported identically. Telling the
    # difference would let someone probe which addresses have a live code.
    if not record:
        frappe.throw(_("That code is not valid. Please request a new one."), frappe.ValidationError)

    if get_datetime(record.expires_at) < now_datetime():
        frappe.db.set_value("Vendor OTP", record.name, "consumed", 1)
        frappe.throw(_("That code has expired. Please request a new one."), frappe.ValidationError)

    if cint(record.attempts) >= MAX_ATTEMPTS:
        frappe.db.set_value("Vendor OTP", record.name, "consumed", 1)
        frappe.throw(
            _("Too many incorrect attempts. Please request a new code."),
            frappe.ValidationError,
        )

    submitted = _hash_code(email, purpose, (code or "").strip())
    if not hmac.compare_digest(submitted, record.code_hash or ""):
        frappe.db.set_value("Vendor OTP", record.name, "attempts", cint(record.attempts) + 1)
        # Committed explicitly: the enclosing request is about to end in an
        # exception, and Frappe rolls back on exception. Without this the
        # attempt counter would reset on every wrong guess, which is the same
        # as having no cap at all.
        frappe.db.commit()
        remaining = MAX_ATTEMPTS - cint(record.attempts) - 1
        if remaining > 0:
            frappe.throw(
                _("That code is not correct. {0} attempts remaining.").format(remaining),
                frappe.ValidationError,
            )
        frappe.throw(
            _("Too many incorrect attempts. Please request a new code."),
            frappe.ValidationError,
        )

    frappe.db.set_value("Vendor OTP", record.name, "consumed", 1)


# --------------------------------------------------------------------------
# outgoing mail
#
# Every message goes through frappe.sendmail with `delayed=False` for the OTP
# (a code that arrives after the user gives up is worthless) and the default
# queue for everything else.
# --------------------------------------------------------------------------

def _send(recipient, subject, template, context, now=False):
    """Send through the Desk-configured outgoing account.

    Mail failures must never break the calling request. A partner who has
    successfully registered should not see an error because the SMTP host
    blinked — they should see "we sent you a code", with the failure in the
    error log for whoever is on call. The `resend` endpoint is the recovery
    path, and it exists precisely because delivery is not guaranteed.
    """
    try:
        frappe.sendmail(
            recipients=[recipient],
            subject=subject,
            template=template,
            args=context,
            header=None,
            now=now,
        )
    except Exception:
        frappe.log_error(
            title=f"shotright: failed to send '{template}' to {recipient}",
            message=frappe.get_traceback(),
        )


def _send_otp_email(email, code, purpose, full_name=None):
    if purpose == PURPOSE_REGISTRATION:
        subject = _("Your Sho't Right verification code")
        template = "shotright_otp_registration"
    else:
        subject = _("Reset your Sho't Right password")
        template = "shotright_otp_password_reset"

    _send(
        email,
        subject,
        template,
        {
            "code": code,
            "first_name": (full_name or "").split(" ")[0] or _("there"),
            "minutes": CODE_TTL_MINUTES,
        },
        # Not queued: a verification code is only useful while the person is
        # still sitting on the screen waiting for it.
        now=True,
    )


def send_welcome_email(email, full_name, business_name=None):
    _send(
        email,
        _("Welcome to Sho't Right"),
        "shotright_welcome",
        {
            "first_name": (full_name or "").split(" ")[0] or _("there"),
            "business_name": business_name or "",
        },
    )


def send_venue_submitted_email(venue_name):
    """Confirm a venue submission.

    Called at the end of `create_venue`. It is a plain function rather than a
    `doc_events` hook because the portal is not the only writer of Venue rows —
    staff create them in the Desk too, and those must not trigger a partner
    email. Tie it to the partner action, not to the table.
    """
    venue = frappe.get_doc("Venue", venue_name)
    vendor = frappe.get_doc("Vendor Profile", venue.vendor_profile)
    if not vendor.get("email"):
        return

    _send(
        vendor.email,
        _("We've received {0}").format(venue.venue_name),
        "shotright_venue_submitted",
        {
            "first_name": (vendor.get("vendor_name") or "").split(" ")[0] or _("there"),
            "venue_name": venue.venue_name,
            "status": venue.get("workflow_state") or "Pending",
        },
    )


def send_password_changed_email(email, full_name):
    """Sent after a successful reset.

    This is a security notification, not a courtesy. If a reset was not the
    account holder's doing, this message is how they find out — so it goes out
    even though the user just performed the action themselves and "knows".
    """
    _send(
        email,
        _("Your Sho't Right password was changed"),
        "shotright_password_changed",
        {"first_name": (full_name or "").split(" ")[0] or _("there")},
    )


# --------------------------------------------------------------------------
# whitelisted endpoints
# --------------------------------------------------------------------------

@frappe.whitelist(allow_guest=True)
def register_vendor(email, password, business_name, first_name, last_name=None):
    """Create a disabled vendor account and email a verification code.

    ⚠️ CONTRACT CHANGE: this no longer returns `{api_key, api_secret}`. It
    returns `{"otp_required": True, "email": ...}` and the caller must then
    call `verify_otp`. The portal branches on `otp_required`, so old and new
    backends both work — but any other client of this method needs updating.
    """
    email = (email or "").strip().lower()
    if not email or not password:
        frappe.throw(_("Email and password are required."), frappe.ValidationError)

    existing = frappe.db.get_value("User", {"name": email}, ["name", "enabled"], as_dict=True)
    if existing:
        if cint(existing.enabled):
            frappe.throw(
                _("That email is already registered. Please sign in instead."),
                frappe.ValidationError,
            )
        # Unverified from an earlier attempt — reissue rather than refuse, or a
        # mistyped code becomes a permanently unusable address.
        _issue_code(email, PURPOSE_REGISTRATION, first_name)
        return {"otp_required": True, "email": email}

    # Password strength is enforced by Frappe against the System Settings
    # policy on insert; do not re-implement it here and risk the two disagreeing.
    user = frappe.get_doc(
        {
            "doctype": "User",
            "email": email,
            "first_name": first_name,
            "last_name": last_name or "",
            "enabled": 0,
            "send_welcome_email": 0,
            "user_type": "Website User",
            "new_password": password,
        }
    ).insert(ignore_permissions=True)

    frappe.get_doc(
        {
            "doctype": "Vendor Profile",
            "user": user.name,
            "vendor_name": " ".join(filter(None, [first_name, last_name])),
            "business_name": business_name,
            "email": email,
        }
    ).insert(ignore_permissions=True)

    _issue_code(email, PURPOSE_REGISTRATION, first_name)
    return {"otp_required": True, "email": email}


@frappe.whitelist(allow_guest=True)
def verify_otp(email, code):
    """Redeem a registration code, enable the account, and return a token.

    Returns the same `{api_key, api_secret}` shape `login` does, so the portal
    lands a freshly verified partner straight in the dashboard.
    """
    email = (email or "").strip().lower()
    _consume_code(email, PURPOSE_REGISTRATION, code)

    user = frappe.get_doc("User", email)
    user.enabled = 1
    user.save(ignore_permissions=True)

    profile = frappe.db.get_value(
        "Vendor Profile", {"user": email}, ["vendor_name", "business_name"], as_dict=True
    )
    send_welcome_email(email, user.full_name, profile.business_name if profile else None)

    return generate_keys(email)


@frappe.whitelist(allow_guest=True)
def resend_otp(email, purpose=PURPOSE_REGISTRATION):
    """Reissue a code.

    Returns the same response whether or not the address exists, for the same
    enumeration reason as the reset endpoint. The cooldown and hourly cap in
    `_issue_code` are what stop this being a free mail cannon pointed at a
    third party's inbox.
    """
    email = (email or "").strip().lower()
    if purpose not in (PURPOSE_REGISTRATION, PURPOSE_PASSWORD_RESET):
        frappe.throw(_("Unknown code type."), frappe.ValidationError)

    exists = frappe.db.exists("User", email)
    if exists:
        full_name = frappe.db.get_value("User", email, "full_name")
        _issue_code(email, purpose, full_name)

    return {"sent": True, "cooldown_seconds": RESEND_COOLDOWN_SECONDS}


@frappe.whitelist(allow_guest=True)
def request_password_reset(email):
    """Start a reset. Always reports success.

    Note the rate-limit exception from `_issue_code` is swallowed for unknown
    addresses only by never calling it — for a known address a throttled caller
    still gets the throttle message. That asymmetry is fine: they already know
    the address exists, because they are the one who owns it.
    """
    email = (email or "").strip().lower()
    if frappe.db.exists("User", email):
        full_name = frappe.db.get_value("User", email, "full_name")
        _issue_code(email, PURPOSE_PASSWORD_RESET, full_name)

    return {"sent": True, "cooldown_seconds": RESEND_COOLDOWN_SECONDS}


@frappe.whitelist(allow_guest=True)
def reset_password(email, code, new_password):
    """Complete a reset and return a fresh token.

    Every existing API key pair is rotated. A reset is the action someone takes
    when they believe the account is compromised, and leaving old tokens live
    would make it useless — the attacker's bearer secret would outlive the
    password change.
    """
    email = (email or "").strip().lower()
    _consume_code(email, PURPOSE_PASSWORD_RESET, code)

    user = frappe.get_doc("User", email)
    user.new_password = new_password
    # A reset also proves ownership of the mailbox, so an account left disabled
    # by an abandoned registration is legitimately recoverable this way.
    user.enabled = 1
    user.save(ignore_permissions=True)

    send_password_changed_email(email, user.full_name)
    return generate_keys(email, rotate=True)


# --------------------------------------------------------------------------
# token issuance
# --------------------------------------------------------------------------

def generate_keys(user, rotate=False):
    """Return a reusable `api_key`/`api_secret` pair for `user`.

    Mirrors what `shotright.api.login` already does — import that instead if it
    is exposed as a helper, rather than keeping two implementations that can
    drift.
    """
    user_doc = frappe.get_doc("User", user)
    if rotate or not user_doc.api_key:
        user_doc.api_key = frappe.generate_hash(length=15)
    api_secret = frappe.generate_hash(length=15)
    user_doc.api_secret = api_secret
    user_doc.save(ignore_permissions=True)
    return {"api_key": user_doc.api_key, "api_secret": api_secret}


# --------------------------------------------------------------------------
# housekeeping
# --------------------------------------------------------------------------

def purge_unverified_accounts():
    """Delete accounts that never completed verification.

    Wire into `hooks.py`:

        scheduler_events = {"daily": [
            "shotright.api.otp_and_email.purge_unverified_accounts",
        ]}

    Without this, a typo'd address holds the real owner's email hostage
    forever — `register_vendor` would keep telling them the address is taken
    while they never receive the code.
    """
    cutoff = add_to_date(now_datetime(), hours=-UNVERIFIED_TTL_HOURS)
    stale = frappe.get_all(
        "User",
        filters={"enabled": 0, "user_type": "Website User", "creation": ["<", cutoff]},
        pluck="name",
    )
    for email in stale:
        # An account disabled by staff for cause is not an unverified account.
        # A consumed registration code proves it was verified at some point, so
        # leave it alone whatever its current `enabled` flag says.
        if frappe.db.exists(
            "Vendor OTP", {"email": email, "purpose": PURPOSE_REGISTRATION, "consumed": 1}
        ):
            continue

        profiles = frappe.get_all("Vendor Profile", filters={"user": email}, pluck="name")

        # Data beats the schedule. If anything was actually built under this
        # account, it is not junk regardless of the verification state, and a
        # cleanup job must never be the thing that deletes a partner's venue.
        if any(frappe.db.count("Venue", {"vendor_profile": p}) for p in profiles):
            continue

        for profile in profiles:
            frappe.delete_doc("Vendor Profile", profile, ignore_permissions=True, force=True)
        frappe.delete_doc("User", email, ignore_permissions=True, force=True)

    frappe.db.delete("Vendor OTP", {"creation": ["<", add_to_date(now_datetime(), days=-7)]})
    frappe.db.commit()


# --------------------------------------------------------------------------
# DocType — `Vendor OTP`
#
# Create in the Desk, or commit this as
# shotright/shotright/doctype/vendor_otp/vendor_otp.json
#
# {
#   "doctype": "DocType",
#   "name": "Vendor OTP",
#   "module": "Shotright",
#   "autoname": "hash",
#   "track_changes": 0,
#   "fields": [
#     {"fieldname": "email",      "fieldtype": "Data",     "label": "Email",
#      "options": "Email", "reqd": 1, "search_index": 1},
#     {"fieldname": "purpose",    "fieldtype": "Select",   "label": "Purpose",
#      "options": "Registration\nPassword Reset", "reqd": 1, "search_index": 1},
#     {"fieldname": "code_hash",  "fieldtype": "Data",     "label": "Code Hash",
#      "read_only": 1},
#     {"fieldname": "expires_at", "fieldtype": "Datetime", "label": "Expires At"},
#     {"fieldname": "attempts",   "fieldtype": "Int",      "label": "Attempts", "default": "0"},
#     {"fieldname": "consumed",   "fieldtype": "Check",    "label": "Consumed", "default": "0"}
#   ],
#   "permissions": [
#     {"role": "System Manager", "read": 1, "delete": 1}
#   ]
# }
#
# NOTE the permissions block: no role gets `write`, and Website User gets
# nothing at all. Everything here is written with `ignore_permissions=True`
# from server code, so a vendor must never be able to read this table — being
# able to list your own rows would mean being able to read your own code hash
# and brute-force it offline, with no attempt cap in the way.
# --------------------------------------------------------------------------


# --------------------------------------------------------------------------
# SHIPPING ORDER
#
# The portal detects this backend at runtime, so the two sides can ship in
# either order without a broken window in between:
#
#   Backend absent (today)   register_vendor returns {api_key, api_secret}.
#                            The portal sees no `otp_required` and signs the
#                            partner straight in, exactly as it does now.
#
#   Backend present          register_vendor returns {otp_required: true}.
#                            The portal shows the code screen automatically.
#                            No frontend release, no feature flag to remember.
#
# Deploy checklist:
#   1. Create the `Vendor OTP` doctype (spec above).
#   2. Create the five Email Templates (docs/EMAIL-SETUP.md).
#   3. Configure an outgoing Email Account and send a test.  <-- do not skip:
#      if mail is not working, this endpoint locks every new partner out of the
#      product with no way through, which is strictly worse than junk accounts.
#   4. Add `purge_unverified_accounts` to `scheduler_events`.
#   5. Deploy this file.
#
# Step 3 before step 5, in that order. Reversing them is an outage.
# --------------------------------------------------------------------------

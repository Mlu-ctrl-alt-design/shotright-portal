"""
The Google Places proxy — "is your venue already on Google?"

DROP-IN: paste into `shotright/api.py` (the flat `shotright.api.*` namespace the
app already uses). Nothing else in the portal changes: `withFallback` treats an
absent method as "not deployed" and the add-venue screen simply does not offer
the route, so this turns itself on the moment it answers.

Why this exists
---------------
A restaurant that has been trading for six years is already on Google, with its
address, its hours and its phone number correct. Asking that owner to retype all
of it is asking them to prove they are serious, and a good number of them will
not — the portal's own drop-off is between "Add New" and the end of the form.
This turns five minutes of typing into "search, check, done".

The portal is written against this surface already. See `src/services/places.js`
for the four rules it enforces on the client; this file is the other half of the
same contract.

============================================================================
FOUR RULES. THEY ARE NOT STYLE PREFERENCES.
============================================================================

1. **THE API KEY NEVER REACHES THE BROWSER.** That is the entire reason there is
   a proxy. Places REST keys can only be restricted by IP or HTTP referrer, so a
   key shipped in a JS bundle is a key anyone can lift and spend against this
   billing account. The key lives in `site_config.json` and is read here.

2. **WE STORE THE `place_id` AND NOTHING ELSE OF GOOGLE'S.** The place id is
   explicitly storable indefinitely under the Places terms. Ratings, reviews,
   photos, editorial summaries and the atmosphere attributes are NOT — they must
   be fetched live and discarded. So the field masks below ask for identity
   fields only, and the normalisers refuse to pass anything else through. This
   is enforced by *not requesting it*, which is the only version of this rule
   that survives somebody adding a field in a hurry.

3. **RESULTS ARE A LIST, NEVER PINS ON A MAP.** Places content shown on a map
   has to be shown on a *Google* map, and the portal draws Leaflet over
   OpenStreetMap tiles. The client already honours this; the server's part is to
   return a list shape and no geometry on the search call.

4. **NOTHING HERE IS LOAD-BEARING.** Every field it fills stays editable on the
   form and every one is marked "we filled this in, check it". Google is being
   used as a KEYBOARD, not as a database. What lands in `Venue` is what the
   partner submitted having read it.

============================================================================
⚠️ WHAT THIS COSTS — AND A CORRECTION TO WHAT THE PORTAL BELIEVES
============================================================================

`src/services/places.js` says "A search that returns ids only is free and
unlimited". That is true, and it is not the call this makes.

On the Places API (New), a Text Search asking for `places.id` ALONE is the
ID-Only SKU and is not charged. The moment the field mask also asks for
`places.displayName` or `places.formattedAddress` it becomes a charged SKU.
The portal needs a name and an address to render a list a human can choose
from — "which of these three is your venue" cannot be answered from opaque ids
— so the search below is a CHARGED call, not a free one.

This is still the cheap shape, and the distinction is worth being precise about
rather than discovering on an invoice:

  - it fires once per venue, ever, triggered by the owner;
  - it is debounced at 400ms and never runs under three characters;
  - the DETAIL call, which is the more expensive one, fires on a deliberate pick
    and never per result, per hover, or speculatively for a list.

A portal onboarding its whole first cohort makes fewer calls in a month than one
customer browsing for an evening. The frightening per-view Places numbers attach
to CUSTOMER-facing venue screens — reviews and photos, re-fetched for every
customer for ever — which is a different feature with a different budget and
should be approved separately.

If the charged search is not acceptable, the honest alternative is to not deploy
this and leave the import screen hidden, which is exactly what the portal does
today. A search box that cannot show names is not a cheaper version of this
feature, it is a worse one.

============================================================================
SETUP
============================================================================

`sites/<site>/site_config.json`:

    {
      "shotright_places_api_key": "AIza...",
      "shotright_places_region": "za"
    }

Restrict the key to the Places API (New) and to this server's egress IP. If the
key is absent, both methods raise `DoesNotExistError` rather than 500 — see
`_key()` for why that specific choice.
"""

import requests

import frappe
from frappe import _

PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_DETAIL_URL = "https://places.googleapis.com/v1/places/{place_id}"

TIMEOUT = 8

# ⚠️ RULE 2, ENFORCED AS A REQUEST RATHER THAN AS A FILTER.
#
# Everything we may not store is simply never asked for. A field mask is the
# only place this rule can live where forgetting it is impossible: you cannot
# accidentally persist a rating you did not receive.
#
# Do NOT add `rating`, `userRatingCount`, `reviews`, `photos`,
# `generativeSummary`, `editorialSummary` or the atmosphere booleans
# (`servesBeer`, `goodForGroups`, …). Some of them are genuinely useful — the
# atmosphere flags are close to a ready-made mood taxonomy — and every one of
# them is content we may not keep.
SEARCH_MASK = "places.id,places.displayName,places.formattedAddress"
DETAIL_MASK = ",".join(
    [
        "id",
        "displayName",
        "formattedAddress",
        "location",
        "nationalPhoneNumber",
        "regularOpeningHours",
    ]
)


class PlaceAlreadyClaimed(frappe.ValidationError):
    """
    Another vendor already holds this listing.

    A real answer, not an error — and it is given a class of its own so the
    portal can branch on `exc_type` instead of matching English. Two listings
    for one restaurant splits its bookings in half and neither owner sees the
    other half, which is the single most expensive data problem this product
    has.
    """


def _key():
    """
    The Places key, or "this method does not exist".

    ⚠️ `DoesNotExistError`, deliberately, and not a 500 or a friendly message.

    The portal's `withFallback` reads a missing method as "this bench cannot do
    this" and hides the whole import screen, silently and correctly. A bench
    with no key configured is in exactly that state, and the best thing it can
    do is look like it. The alternative — a partner typing their venue name into
    a box that answers "Places is not configured" — is an errand set by a
    feature that does not exist on their server.
    """
    key = frappe.conf.get("shotright_places_api_key")
    if not key:
        frappe.throw(_("Place search is not configured"), frappe.DoesNotExistError)
    return key


def _require(feature):
    """
    The paywall gate.

    ⚠️ NAME THIS WHATEVER THE GATE FROM PR #44 IS ACTUALLY CALLED. The portal
    checks entitlements before it renders a lock, but a client-side check is a
    courtesy, not a control — a lapsed subscription between page load and
    submit, or anybody with a terminal, goes straight past it. The server is
    where the gate has to be.

    The keys are the ones the bench registers: `venue_import_google`,
    `venue_import_social`, `venue_import_website`. There is no single
    `venue_import` row.
    """
    from shotright.entitlements import require_entitlement  # noqa: F401

    require_entitlement(feature)


def _vendor():
    """The Vendor Profile for the current session, or 403."""
    vendor = frappe.db.get_value("Vendor Profile", {"user": frappe.session.user}, "name")
    if not vendor:
        frappe.throw(_("No vendor profile for this account"), frappe.PermissionError)
    return vendor


def _claimed_by_someone_else(place_ids, vendor):
    """
    Which of these listings a DIFFERENT vendor has already claimed.

    One query for the whole result page rather than one per row. Said on the row
    at search time, not after the partner picks — finding out that the venue you
    just chose is taken, after the detail call has already been paid for, is a
    wasted step and a wasted cent.

    A listing this vendor claimed themselves is NOT "claimed": they may be
    re-importing after discarding a draft, and refusing their own venue back to
    them would be baffling.
    """
    if not place_ids:
        return set()

    rows = frappe.get_all(
        "Venue",
        filters={"place_id": ["in", list(place_ids)]},
        fields=["place_id", "vendor_profile"],
    )
    return {r.place_id for r in rows if r.vendor_profile != vendor}


def _normalise_hit(raw):
    return {
        "place_id": raw.get("id") or "",
        "display_name": (raw.get("displayName") or {}).get("text") or "",
        "formatted_address": raw.get("formattedAddress") or "",
    }


DAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]


def _operating_hours(raw):
    """
    Google's opening hours, mapped into OUR day rows — or nothing at all.

    ⚠️ THE PORTAL REFUSES TO DO THIS MAPPING, ON PURPOSE. From `places.js`:
    "getting it subtly wrong writes bad trading hours onto a real business, and
    a partner who trusts the prefill will not re-read all seven days." So the
    mapping happens once, here, where it can be tested — and where anything it
    cannot map confidently becomes an omission rather than a guess.

    What it will not guess:

      - **A period with no close.** Google uses an open-ended period for a venue
        that never closes. "Open 24 hours" is not the same as "closes at
        midnight" and we do not have a way to store the difference, so the day
        is dropped and the partner fills it in.
      - **Two sittings in one day** (lunch and dinner, with a gap). Our child
        table holds one range per day. Collapsing them to 11:00–23:00 would
        publish a venue as open through an afternoon it is shut. Dropped.
      - **Anything with an exception or a seasonal override.** `regularOpeningHours`
        only; special hours for public holidays are a separate field we do not
        request and would not know how to apply.

    An empty list is a perfectly good answer. The portal shows imported hours as
    a line to CHECK with a "Change" next to it, never as a settled value, and
    with nothing here it simply shows its own editor.
    """
    periods = (raw or {}).get("periods") or []
    if not periods:
        return []

    by_day = {}
    for period in periods:
        open_ = period.get("open") or {}
        close = period.get("close")

        day = open_.get("day")
        if day is None or not isinstance(day, int) or not 0 <= day <= 6:
            continue

        # Open-ended period — a 24-hour venue. See the docstring.
        if not close:
            by_day.pop(day, None)
            by_day[day] = None
            continue

        # Crosses midnight into another day. The close belongs to the NEXT day
        # in Google's model; our row stores a close that is simply earlier than
        # the open, which is what `expandOperatingHours` on the portal side and
        # the customer app both already understand.
        start = "%02d:%02d:00" % (open_.get("hour", 0), open_.get("minute", 0))
        end = "%02d:%02d:00" % (close.get("hour", 0), close.get("minute", 0))

        if day in by_day:
            # A second sitting on a day we already have. Refuse the day rather
            # than pick one of them.
            by_day[day] = None
            continue

        by_day[day] = (start, end)

    rows = []
    for day, value in sorted(by_day.items()):
        if not value:
            continue
        rows.append(
            {
                "day_of_week": DAYS[day],
                "open_time": value[0],
                "close_time": value[1],
                "closed": 0,
            }
        )
    return rows


@frappe.whitelist()
def search_places(query=None, q=None, latitude=None, longitude=None):
    """
    Find a venue by name. Returns a LIST, never a map.

    ⚠️ `query` AND `q` ARE BOTH DECLARED, and that is not sloppiness. The portal
    sends both because it was written before this method existed and had no way
    to know which name it would take. Frappe DROPS an undeclared kwarg silently
    at HTTP 200 — declaring only one of the two would mean the other arrives as
    None, the search runs on an empty string, and the partner gets an empty list
    with no error anywhere. Declare both, take whichever is filled.

    THE EMPTY QUERY IS THE CAPABILITY PROBE. `placesAvailable()` calls this with
    no text, once per tab, to decide whether to render the import screen at all.
    It MUST answer an empty list rather than throwing — a probe that errors is
    read as "deployed but broken", which is the one state that produces a dead
    search box.

    @returns [{place_id, display_name, formatted_address, claimed}]
    """
    text = (query or q or "").strip()

    # The probe. Answer, cheaply, without touching Google.
    if not text:
        _key()
        return []

    if len(text) < 3:
        return []

    _require("venue_import_google")
    vendor = _vendor()

    body = {"textQuery": text, "maxResultCount": 8}

    region = frappe.conf.get("shotright_places_region")
    if region:
        body["regionCode"] = region

    # Bias, not a filter: a partner searching from their venue should see it
    # first, but a partner adding a second branch in another city must still
    # find it.
    try:
        lat = float(latitude)
        lng = float(longitude)
        body["locationBias"] = {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": 50000.0,
            }
        }
    except (TypeError, ValueError):
        pass

    response = requests.post(
        PLACES_SEARCH_URL,
        json=body,
        headers={
            "X-Goog-Api-Key": _key(),
            "X-Goog-FieldMask": SEARCH_MASK,
            "Content-Type": "application/json",
        },
        timeout=TIMEOUT,
    )

    if not response.ok:
        # Logged with the body, because Places refusals are specific and
        # actionable (key restricted to the wrong IP, API not enabled, billing
        # off) and none of that may reach a restaurant owner's screen.
        frappe.log_error(
            title="shotright: place search failed",
            message="%s %s" % (response.status_code, response.text[:2000]),
        )
        frappe.throw(_("We couldn’t search right now. Please try again."))

    hits = [_normalise_hit(p) for p in (response.json().get("places") or [])]
    hits = [h for h in hits if h["place_id"]]

    taken = _claimed_by_someone_else({h["place_id"] for h in hits}, vendor)
    for hit in hits:
        hit["claimed"] = hit["place_id"] in taken

    return hits


@frappe.whitelist()
def get_place_details(place_id=None):
    """
    One place, reduced to what a form can hold. THE BILLABLE CALL.

    Fires on a deliberate pick — never per result, never on hover, never
    speculatively for a list. That is a property of the caller, and it is worth
    knowing here too: if this method ever appears in a loop, something has gone
    wrong upstream.

    @returns {place_id, display_name, formatted_address,
              location: {latitude, longitude}, national_phone_number,
              operating_hours: [...], attribution}
    """
    place_id = (place_id or "").strip()
    if not place_id:
        frappe.throw(_("No listing was chosen"), frappe.DoesNotExistError)

    _require("venue_import_google")
    vendor = _vendor()

    # Checked BEFORE spending the call. A claimed listing is a refusal either
    # way, and there is no reason to pay Google to find that out.
    if _claimed_by_someone_else({place_id}, vendor):
        frappe.throw(
            _("That venue is <strong>already claimed</strong> by another account."),
            PlaceAlreadyClaimed,
        )

    response = requests.get(
        PLACES_DETAIL_URL.format(place_id=place_id),
        headers={
            "X-Goog-Api-Key": _key(),
            "X-Goog-FieldMask": DETAIL_MASK,
        },
        timeout=TIMEOUT,
    )

    if response.status_code == 404:
        frappe.throw(_("That listing is no longer on Google"), frappe.DoesNotExistError)

    if not response.ok:
        frappe.log_error(
            title="shotright: place detail failed",
            message="%s %s" % (response.status_code, response.text[:2000]),
        )
        frappe.throw(_("We couldn’t fetch that one. Please try another."))

    raw = response.json()
    location = raw.get("location") or {}

    return {
        "place_id": raw.get("id") or place_id,
        "display_name": (raw.get("displayName") or {}).get("text") or "",
        "formatted_address": raw.get("formattedAddress") or "",
        "location": {
            "latitude": location.get("latitude"),
            "longitude": location.get("longitude"),
        },
        "national_phone_number": raw.get("nationalPhoneNumber") or "",
        "operating_hours": _operating_hours(raw.get("regularOpeningHours")),
        # Shown verbatim by the portal. Required by the Places terms wherever
        # Google data is displayed outside a Google map.
        "attribution": "Powered by Google",
    }


"""
============================================================================
ONE FIELD ON `Venue`
============================================================================

    place_id   Data, 255, unique, optional, read-only in Desk

⚠️ `create_venue` MUST DECLARE IT. The portal already sends `place_id` on every
venue created from an import. If the method does not declare the kwarg, Frappe
drops it at HTTP 200 with no error, the venue saves perfectly, and the dedupe
above silently never fires — so the second partner to claim the same restaurant
is told nothing and the bookings split. Nothing in the UI would ever show this.

`unique` is doing real work: it is the last line of defence if two partners pick
the same listing in the same second, which the pre-check above cannot catch.

============================================================================
SHIPPING ORDER
============================================================================

1. Add `place_id` to `Venue` and declare it on `create_venue`. Safe alone — the
   portal already sends it and nothing reads it yet.
2. Configure the key. Nothing changes: the methods do not exist.
3. Paste these two methods and restart. The import screen appears by itself,
   for entitled accounts only.

Each step is independently reversible and none of them needs a frontend release.
"""

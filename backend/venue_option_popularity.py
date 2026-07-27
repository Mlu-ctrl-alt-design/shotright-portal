"""
Aggregate popularity for the venue-details dropdowns.

Backs the Tier C smart defaults in the partner portal ("Most venues pick this
(62%)"). Drop into `shotright/api/` alongside the rest of the whitelisted
surface. The portal detects it at runtime: until it exists, the dropdowns render
with no default and no chip, which is the spec's own acceptable degradation.

WHY THIS IS A SERVER ENDPOINT AND NOT A CLIENT-SIDE COUNT
---------------------------------------------------------
The portal only ever sees one vendor's venues. The statistic that makes the
suggestion worth showing — "62% of venues" — is a property of the whole
platform, and a partner with three venues computing it from their own three
would produce a number that is both wrong and quietly self-confirming.

THE FEEDBACK LOOP, WHICH IS THE REAL RISK HERE
-----------------------------------------------
A pre-selected dropdown that nobody reads produces submissions that reinforce
the selection that produced them. Left alone this converges on 100% and the
share stops meaning anything.

Three things below limit that, and they are not optional decoration:

  * **Approved venues only.** An unreviewed submission has not been looked at by
    anyone, so counting it lets the loop close without a human in it.
  * **A floor on the sample.** Below `MIN_SAMPLE` venues the share is noise, and
    the endpoint returns nothing rather than a confident-looking small number.
  * **A ceiling on the share.** Past `MAX_SHARE` the value is more likely to be
    the loop than the population. Returning nothing there deliberately switches
    the default OFF for the dominant option, which lets the distribution
    re-spread. This is the counter-intuitive one and the one most likely to be
    "fixed" by someone who reads it as a bug — it is not.

If you want the honest version of this number, exclude venues whose value
matches what the portal offered them and count only deliberate choices. That
needs the portal to record whether the default was accepted (it emits
`default_accepted`; nothing stores it yet). Until then, the guards above are the
approximation.
"""

import frappe

MIN_SAMPLE = 25
MAX_SHARE = 85


def _top_value(fieldname):
    """Most common non-empty value of `fieldname` across approved venues.

    Returns `{"value", "share"}` or None. `share` is a whole-number percentage
    of the venues that had ANY value for the field — not of all venues, or a
    field most people skip would report a misleadingly small share for the
    option that actually dominates it.
    """
    rows = frappe.db.sql(
        f"""
        SELECT `{fieldname}` AS value, COUNT(*) AS n
        FROM `tabVenue`
        WHERE workflow_state = 'Approved'
          AND `{fieldname}` IS NOT NULL
          AND TRIM(`{fieldname}`) != ''
        GROUP BY `{fieldname}`
        ORDER BY n DESC
        LIMIT 1
        """,
        as_dict=True,
    )
    if not rows:
        return None

    total = frappe.db.sql(
        f"""
        SELECT COUNT(*) FROM `tabVenue`
        WHERE workflow_state = 'Approved'
          AND `{fieldname}` IS NOT NULL
          AND TRIM(`{fieldname}`) != ''
        """
    )[0][0]

    if not total or total < MIN_SAMPLE:
        return None

    share = round(rows[0].n * 100 / total)
    if share > MAX_SHARE:
        return None

    return {"value": rows[0].value, "share": share}


@frappe.whitelist()
def get_popular_venue_options():
    """`{dress_code: {value, share}, atmosphere: {value, share}}`.

    Either key may be absent, and the portal handles that per-field rather than
    all-or-nothing — dress code can be well-established while atmosphere is
    still too sparse to call.

    Cheap enough to compute per request at current volumes. If it stops being
    cheap, cache it for a day rather than adding an index: the spec says the
    ranking is refreshed nightly, so a day-old answer is the intended
    freshness, not a compromise.
    """
    result = {}

    dress = _top_value("dress_code")
    if dress:
        result["dress_code"] = dress

    # NOTE the field name: the backend stores `atmosphere_desc`, and it is FREE
    # TEXT rather than a select. Ranking free text means near-duplicates
    # ("Family friendly" vs "family-friendly") split the vote and can suppress a
    # genuinely dominant option below the reporting floor. If atmosphere never
    # clears MIN_SAMPLE, that is the likely cause, and the fix is to make it a
    # Select — not to lower the floor.
    atmosphere = _top_value("atmosphere_desc")
    if atmosphere:
        result["atmosphere"] = atmosphere

    return result

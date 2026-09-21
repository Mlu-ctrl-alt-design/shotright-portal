"""
Import a venue from its own website (and the truth about Facebook/Instagram).

DROP-IN: paste into `shotright/api.py`. The portal detects it at runtime — until
it answers, the "Facebook or Instagram" and "Your website" routes are not
rendered at all. See `src/services/venueSources.js`.

ONE METHOD FOR BOTH ROUTES, deliberately. They are the same job — fetch a page,
pull out name, address, phone, hours — and splitting them into two endpoints
buys nothing but a second thing to deploy. `source` is a hint, not a contract.

============================================================================
⚠️ READ THIS BEFORE BUILDING THE FACEBOOK / INSTAGRAM ROUTE
============================================================================

The design shows three import routes. Two of them are honest. The third needs a
decision from a human before anybody writes more code.

**Scraping a Facebook or Instagram page server-side does not work, and will not
be made to work by trying harder.** Both serve a login wall to datacentre IPs,
render their content from JavaScript, and rate-limit and block bot traffic
aggressively. A scraper will pass a test against one page on somebody's laptop
and then return nothing — or, worse, intermittently return nothing — for real
partners from a South African bench. It is also squarely against both platforms'
terms of service, which matters when the account doing it belongs to a business.

There are exactly three honest options:

1. **Use the official Graph API.** Real, supported, and it requires the partner
   to log in with Facebook and grant access to a Page they administer
   (`pages_show_list`, `pages_read_engagement`). That is a genuinely better
   product — it also PROVES they own the page, which scraping never does — and
   it is a different feature with a login flow, an app review, and a week of
   work. It is not this method.

2. **Drop the route.** The portal already hides routes the bench cannot serve,
   so this costs nothing and misleads nobody.

3. **Ship the website importer only** and let a partner paste their linktree or
   their site. Most small venues have one, and the structured data on it is
   usually better than what is on their Facebook page anyway.

What must NOT happen is a route that accepts an Instagram URL into a box and
returns nothing most of the time. The partner has then spent the time AND lost
the trust, which is worse than never having offered.

**This file implements the website importer.** `source="social"` is accepted and
routed through the same parser, because a public page occasionally does serve
Open Graph tags to a server — but it is explicitly best-effort, it returns an
empty result rather than an error when it gets a login wall, and the portal's
copy for that route should not promise more than that until option 1 is built.

============================================================================
⚠️ SSRF — THE PART THAT CAN ACTUALLY HURT SOMEBODY
============================================================================

This method takes a URL from an unauthenticated-ish user and fetches it FROM
INSIDE THE BENCH. Written naively, that is a hole straight onto the private
network — and this bench is not alone on its box. It shares a host with other
sites, a Redis, a MariaDB, and whatever the cloud provider exposes on its
metadata address.

A partner (or anybody who registers) could otherwise ask this method to fetch:

    http://127.0.0.1:8000/api/method/...     another site on this bench
    http://169.254.169.254/latest/meta-data/ cloud credentials
    http://10.x.x.x / 192.168.x.x            anything else on the network
    file:///etc/passwd                       local files
    http://evil.test → 302 → 127.0.0.1       the redirect version of all of it

`_safe_url()` and `_fetch()` below defend against every one of those, and the
redirect case is the one people forget: validating the URL the user typed and
then handing it to `requests` with `allow_redirects=True` defends nothing at
all, because the hop that matters is the one you never checked.

If you change the fetch, re-read this section. The checks are cheap and the
failure is not recoverable by apology.
"""

import ipaddress
import json
import re
import socket
from urllib.parse import urlparse, urljoin

import requests

import frappe
from frappe import _

TIMEOUT = 8
MAX_REDIRECTS = 3
MAX_BYTES = 2 * 1024 * 1024  # 2 MB of HTML is already a pathological page.

# A real browser UA. Not to evade anything — a good number of small-business
# sites are behind a CDN that serves a challenge page to an obviously scripted
# client, and there is no point failing a partner's import over a header.
USER_AGENT = (
    "Mozilla/5.0 (compatible; ShotRightBot/1.0; +https://shotright.co.za/bot)"
)

SOCIAL_HOSTS = ("facebook.com", "fb.com", "instagram.com", "instagr.am")


def _require(feature):
    """
    The paywall gate. See the note in `places_proxy.py` — name this whatever the
    gate from PR #44 is actually called.

    The client check is a courtesy; this is the control.
    """
    from shotright.entitlements import require_entitlement  # noqa: F401

    require_entitlement(feature)


def _blocked(ip):
    """Every address family a fetch must never reach."""
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local  # 169.254.0.0/16 — the cloud metadata range
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _safe_url(raw):
    """
    Parse, normalise and prove a URL is safe to fetch. Returns the URL, or
    raises.

    ⚠️ RESOLVES DNS AND CHECKS EVERY ADDRESS THE NAME ANSWERS WITH. Checking the
    hostname string is not a check: `localtest.me`, and any domain whose owner
    points it at 127.0.0.1, resolve to loopback while looking perfectly
    ordinary.

    There is a residual DNS-rebinding window here — the name could resolve to a
    public address for this check and a private one for the actual connection a
    moment later. Closing it properly means pinning the resolved IP and
    connecting to it with the Host header set by hand, which is worth doing if
    this ever becomes a high-volume path. For a once-per-venue import behind a
    paid entitlement, the checked-resolve plus the per-hop re-check below is a
    proportionate defence, and it is written down here so the next person is
    choosing rather than assuming.
    """
    text = (raw or "").strip()
    if not text:
        frappe.throw(_("No link was given"), frappe.DoesNotExistError)

    # Partners type "yourvenue.co.za", not "https://yourvenue.co.za".
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", text):
        text = "https://" + text

    parsed = urlparse(text)

    # `file:`, `ftp:`, `gopher:`, `dict:` — all of them are a way to read
    # something that is not a web page.
    if parsed.scheme not in ("http", "https"):
        frappe.throw(_("That is not a web address"))

    if not parsed.hostname:
        frappe.throw(_("That is not a web address"))

    # A port that is not a web port is somebody probing the network rather than
    # importing a restaurant.
    if parsed.port not in (None, 80, 443, 8080, 8443):
        frappe.throw(_("That is not a web address"))

    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        frappe.throw(_("We couldn’t reach that address"))

    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if _blocked(ip):
            # Deliberately the same message a partner gets for a typo. Telling
            # somebody "that resolved to a private range" is telling them the
            # shape of the network they were probing.
            frappe.throw(_("We couldn’t reach that address"))

    return text


def _fetch(url):
    """
    GET a page, following redirects BY HAND so every hop is checked.

    `allow_redirects=True` would validate the URL the partner typed and then
    follow a 302 to 127.0.0.1 without a word. That is the entire bypass, and it
    is why this loop exists rather than one line of `requests`.

    Streams and caps the body: a page that is 400 MB of zeros is a way to take
    the worker down, and no venue's homepage needs two megabytes of HTML.
    """
    current = url

    for _hop in range(MAX_REDIRECTS + 1):
        current = _safe_url(current)

        response = requests.get(
            current,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-ZA,en;q=0.9",
            },
            timeout=TIMEOUT,
            allow_redirects=False,
            stream=True,
        )

        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("Location")
            response.close()
            if not location:
                return ""
            current = urljoin(current, location)
            continue

        if not response.ok:
            response.close()
            return ""

        content_type = (response.headers.get("Content-Type") or "").lower()
        if "html" not in content_type and "xml" not in content_type:
            response.close()
            return ""

        body = b""
        for chunk in response.iter_content(8192):
            body += chunk
            if len(body) > MAX_BYTES:
                break
        response.close()

        return body.decode(response.encoding or "utf-8", errors="replace")

    return ""


def _json_ld(html):
    """
    Every JSON-LD block on the page, flattened.

    THIS IS WHERE THE GOOD DATA IS. schema.org `Restaurant`, `LocalBusiness`,
    `BarOrPub` and `FoodEstablishment` carry name, address, telephone and
    opening hours in a structured form that somebody deliberately published for
    exactly this purpose. Anything we fall back to afterwards is guesswork by
    comparison.

    Handles the three shapes real sites use: a bare object, an array of them,
    and an `@graph` wrapper.
    """
    blocks = []
    for match in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.DOTALL | re.IGNORECASE,
    ):
        try:
            parsed = json.loads(match.group(1).strip())
        except (ValueError, TypeError):
            continue

        if isinstance(parsed, dict) and "@graph" in parsed:
            parsed = parsed["@graph"]

        if isinstance(parsed, list):
            blocks.extend([b for b in parsed if isinstance(b, dict)])
        elif isinstance(parsed, dict):
            blocks.append(parsed)

    return blocks


BUSINESS_TYPES = {
    "restaurant",
    "localbusiness",
    "barorpub",
    "foodestablishment",
    "cafe",
    "nightclub",
    "bakery",
    "brewery",
    "winery",
    "organization",
    "hotel",
    "lodgingbusiness",
}


def _is_business(block):
    types = block.get("@type") or ""
    if isinstance(types, str):
        types = [types]
    return any(str(t).lower() in BUSINESS_TYPES for t in types)


def _address(block):
    """schema.org PostalAddress → one line, in the order a South African reads."""
    address = block.get("address")
    if isinstance(address, str):
        return address.strip()
    if not isinstance(address, dict):
        return ""

    parts = [
        address.get("streetAddress"),
        address.get("addressLocality"),
        address.get("addressRegion"),
        address.get("postalCode"),
    ]
    return ", ".join([str(p).strip() for p in parts if p and str(p).strip()])


DAY_NAMES = {
    "monday": "Monday",
    "tuesday": "Tuesday",
    "wednesday": "Wednesday",
    "thursday": "Thursday",
    "friday": "Friday",
    "saturday": "Saturday",
    "sunday": "Sunday",
}


def _hours(blocks):
    """
    `openingHoursSpecification` → our day rows.

    Same refusal to guess as the Places mapper: a day we cannot read
    confidently is omitted, never approximated. The portal shows imported hours
    as a line to CHECK, and an empty list simply means it shows its own editor
    instead. Writing a wrong closing time onto a real business is the failure
    worth avoiding here — a partner who trusts the prefill will not re-read all
    seven days.
    """
    rows = {}

    for block in blocks:
        spec = block.get("openingHoursSpecification")
        if isinstance(spec, dict):
            spec = [spec]
        if not isinstance(spec, list):
            continue

        for entry in spec:
            if not isinstance(entry, dict):
                continue

            opens = entry.get("opens")
            closes = entry.get("closes")
            if not opens or not closes:
                continue

            days = entry.get("dayOfWeek") or []
            if isinstance(days, str):
                days = [days]

            for day in days:
                # schema.org days arrive bare ("Monday") or as a URL
                # ("https://schema.org/Monday").
                key = str(day).rstrip("/").split("/")[-1].strip().lower()
                name = DAY_NAMES.get(key)
                if not name:
                    continue

                # A second range for a day we already have — lunch and dinner
                # with a gap. Our child table holds one range per day, so the
                # day is refused rather than collapsed into a span that claims
                # the venue is open through an afternoon it is shut.
                if name in rows:
                    rows[name] = None
                    continue

                rows[name] = (_time(opens), _time(closes))

    out = []
    for name, value in rows.items():
        if not value or not value[0] or not value[1]:
            continue
        out.append(
            {
                "day_of_week": name,
                "open_time": value[0],
                "close_time": value[1],
                "closed": 0,
            }
        )
    return out


def _time(raw):
    """"17:30" / "17:30:00" / "5:30 PM" → "17:30:00", or "" if we cannot tell."""
    text = str(raw or "").strip().upper()

    match = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$", text)
    if not match:
        return ""

    hour = int(match.group(1))
    minute = int(match.group(2))
    meridiem = match.group(4)

    if meridiem == "PM" and hour != 12:
        hour += 12
    elif meridiem == "AM" and hour == 12:
        hour = 0

    if hour > 23 or minute > 59:
        return ""

    return "%02d:%02d:00" % (hour, minute)


def _meta(html, *names):
    """Open Graph / meta fallback, for a page with no structured data."""
    for name in names:
        match = re.search(
            r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]+content=["\']([^"\']*)["\']'
            % re.escape(name),
            html,
            re.IGNORECASE,
        )
        if match and match.group(1).strip():
            return match.group(1).strip()
    return ""


def _phone(html, blocks):
    for block in blocks:
        phone = block.get("telephone")
        if phone:
            return str(phone).strip()

    # `tel:` links are the one piece of contact information almost every venue
    # site marks up correctly, even when it has no structured data at all.
    match = re.search(r'href=["\']tel:([^"\']+)["\']', html, re.IGNORECASE)
    return match.group(1).strip() if match else ""


@frappe.whitelist()
def import_venue_from_url(url=None, source=None):
    """
    Read a venue's details off a web page.

    @param url     the partner's website, or a public social page
    @param source  'website' | 'social' | 'probe' — a hint, not a contract

    @returns the same shape `get_place_details` returns, so the portal's prefill
             path does not care which route filled it in:

             {display_name, formatted_address, location: {...},
              national_phone_number, operating_hours: [...], attribution}

             or `None` when the page had nothing readable on it.

    ⚠️ NEVER RAISES FOR "NOTHING FOUND". An empty page and a login wall are
    ordinary outcomes, and the portal's copy for them is "we couldn't read that
    page — check the link, or type your details in below". Throwing would turn a
    shrug into an incident.

    THE EMPTY URL IS THE CAPABILITY PROBE. `urlImportAvailable()` calls this with
    `url=""` to decide whether to offer the routes at all, and it must answer
    rather than throw.
    """
    text = (url or "").strip()

    # The probe. Answers "I exist" and nothing else.
    if not text or source == "probe":
        return None

    host = (urlparse(_safe_url(text)).hostname or "").lower()
    is_social = source == "social" or any(h in host for h in SOCIAL_HOSTS)

    _require("venue_import_social" if is_social else "venue_import_website")

    try:
        html = _fetch(text)
    except requests.RequestException:
        # A timeout or a refused connection is not worth a stack trace: the
        # partner types it in themselves and carries on.
        return None

    if not html:
        return None

    blocks = _json_ld(html)
    business = [b for b in blocks if _is_business(b)]
    primary = business[0] if business else {}

    name = (
        str(primary.get("name") or "").strip()
        or _meta(html, "og:site_name", "og:title", "twitter:title")
        or _title(html)
    )
    address = _address(primary)
    phone = _phone(html, business or blocks)
    hours = _hours(business)

    geo = primary.get("geo") if isinstance(primary.get("geo"), dict) else {}
    latitude = _float(geo.get("latitude"))
    longitude = _float(geo.get("longitude"))

    # Nothing worth handing back. The portal says so plainly and the partner
    # types it in — which is the same number of keystrokes they would have had
    # without this feature, and no worse.
    if not name and not address and not phone:
        return None

    return {
        "place_id": "",
        "display_name": name,
        "formatted_address": address,
        "location": {"latitude": latitude, "longitude": longitude},
        "national_phone_number": phone,
        "operating_hours": hours,
        # No attribution string: unlike Places, this is the partner's own page.
        "attribution": "",
    }


def _title(html):
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.DOTALL | re.IGNORECASE)
    if not match:
        return ""
    # Strip the "| Best Braai in Pretoria | Home" tail most CMS themes append.
    return re.sub(r"\s*[|–—-]\s*.*$", "", match.group(1).strip())[:140]


def _float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


"""
============================================================================
WHAT TO TEST, AND WHY THESE AND NOT A HAPPY PATH
============================================================================

The happy path here is the least interesting thing about this method. These are
the cases that decide whether it is safe:

    import_venue_from_url("http://127.0.0.1:8000/api/method/frappe.ping")
    import_venue_from_url("http://169.254.169.254/latest/meta-data/")
    import_venue_from_url("file:///etc/passwd")
    import_venue_from_url("http://10.0.0.5/")
    import_venue_from_url("https://localtest.me/")          # public name → 127.0.0.1
    import_venue_from_url("<a URL that 302s to 127.0.0.1>") # the one people miss

Every one of them must refuse, and the last one must refuse on the HOP, not on
the URL that was typed.

Then the ordinary ones:

    a site with schema.org Restaurant JSON-LD      → name, address, phone, hours
    a site with only Open Graph tags               → name, maybe nothing else
    a site with a `tel:` link and nothing else     → phone
    a page with two sittings on a Wednesday        → Wednesday omitted, not merged
    an instagram.com URL from a datacentre IP      → None, no exception
    a 400 MB response                              → capped, no worker death

============================================================================
SHIPPING ORDER
============================================================================

1. Decide the Facebook/Instagram question at the top of this file. It is a
   product decision, not an engineering one, and the copy on that route depends
   on the answer.
2. Deploy this for `website` only if that decision is still open — the portal
   renders routes independently, so the website route can ship alone.
3. The entitlement keys are `venue_import_website` and `venue_import_social`.
   Register them before deploying, or every partner sees a paywall for a feature
   that is switched on.
"""

# API Integration Clearance — venue upload journey

## Verdict

**NOT CLEARED — `POST /api/method/upload_file` is BLOCKED.**

Everything downstream of it (venue photos, menu import) is blocked with it. The
rest of the venue journey is unaffected and continues to ship.

## Scope & method

| | |
|---|---|
| Target | `shotright.thedaystar.co.za` — **production**. There is no staging bench. |
| Mode | **STATIC.** The QA environment's egress proxy refuses CONNECT to that host (403), so no request in this report was actually sent. |
| Accounts | None used. **A second partner account is still needed** — cross-tenant checks are invisible without one. |
| Collection | None exists. The inventory below is read from the portal's own service layer. |

> **Nothing here is confirmed.** Every finding is a prediction until
> `qa/probe-upload.sh` is run against the bench. Written as "unverified"
> throughout, deliberately — a wrongly-green report gets built on.

## Findings

### P1 — `upload_file` refuses every upload the portal makes *(unverified)*

**Reported** 8 Aug from the live portal, twice, from screens that look
unrelated: *"images still cannot be attached"* and *"the menu upload is not
working"*. Both post to `/api/method/upload_file`.

**Request** — the two the portal makes, differing in one respect:

| | venue photo | menu import |
|---|---|---|
| `doctype` / `docname` | `Venue` / `VEN-…` | *not sent* |
| `is_private` | `0` | `1` |
| needs | File **create** + Venue **write** | File **create** only |

**Actual** `403`. **Expected** `200` with the File record.

**Why the pair is the whole diagnosis.** If the menu path is *also* refused,
the missing permission cannot be the Venue attach grant added 28 Jul — that
path never asks for it. It would mean the Vendor role cannot create a `File` at
all, which fits the finding already on record in §14: *the Vendor role has no
doctype access whatsoever*, which is why `upload_file`,
`frappe.client.get_list` on `File` and `attachOrphans` all failed together and
were reported as three separate bugs.

**Repro** `./qa/probe-upload.sh <base> <key> <secret> <your-venue>` — probes A
and B.

**Fix, in order of preference:**

1. **A whitelisted `upload_venue_photo(venue_name, file)` that elevates
   internally**, like every other `shotright.api.*` method. This ends the
   dependency on stock Frappe endpoints and the role permissions they need —
   three symptoms have now come from that one dependency.
2. Failing that: grant `File` **create** to the Vendor role, and confirm the
   `Venue` attach grant is live *on this bench* (it may have been applied to
   another).

**Not a P0**: this is a functional block, not a data exposure. It is graded P1
because the frontend cannot build correctly against it — but note the practical
severity is higher than the grade, because it blocks a required step of
onboarding.

### P2 — the response body has never been captured *(unverified)*

Every report so far is a status code and a screenshot. A `403` from Vercel's
edge and a `403` from Frappe are indistinguishable on the status line — the
portal is served from `64.29.17.3` (Vercel) and proxies `/api/*` to
`194.163.168.19` (the bench), so the browser always names Vercel.

The **body** separates them: a Frappe refusal carries `exc_type` and
`_server_messages`; an edge refusal carries neither. The probe script prints
the raw body for exactly this reason.

### P2 — cross-tenant attach is untested *(unverified)*

Nobody has checked whether partner A can attach a file to partner B's venue.
If `upload_file` with `doctype=Venue&docname=<not mine>` returns 200, that is a
**P0** and the collection is not cleared on security grounds as well as
functional ones. Probe E. **Needs a second account.**

### P3 — reading photos back is a separate permission *(open since July)*

Attaching is `Venue` write; listing them is `File` read. §14 asked whether the
Vendor role can list its own venue's `File` rows and never got an answer, which
is why the uploader opens empty on an existing venue. Probe C and D.

## Clearance table

| Endpoint | Tier | Verdict | Conditions |
|---|---|---|---|
| `upload_file` (photo, with doctype) | HIGH | **BLOCKED** | 403. Nothing to integrate against. |
| `upload_file` (menu, no doctype) | HIGH | **BLOCKED** | Same. |
| `get_venue_photos` | LOW | CLEARED WITH CONDITIONS | Portal must keep distinguishing *unreadable* from *empty*. Already does. |
| `create_venue` | HIGH | CLEARED | Unrelated to this. `place_id` declaration still unconfirmed (§20). |
| `update_venue` | HIGH | CLEARED WITH CONDITIONS | Still crashes on `moods` (§00). Portal strips and retries. |

## Frontend contract — `upload_file`

What the portal must handle, and does today:

| Case | HTTP | How to tell | UI owes the partner |
|---|---|---|---|
| Refused | 403 / `PermissionError` | `exc_type`, or "doctype access"/"role permission" in the message | *"This is a problem on our side, not with your file."* **No "try another file"** — the tenth is refused exactly like the first. |
| Too large | 413 | status | Name the limit. |
| Rejected by a hook | 417 | `_server_messages` (double-encoded JSON) | Show the server's words, stripped of HTML. |
| Never arrived | network | no response | Offer a retry — this is the one case where retrying helps. |

**The rule underneath:** a refused upload must never be reported as a problem
with the partner's file. That mistake shipped, and it sends someone off to
re-export a spreadsheet that was never broken.

## Frontend test plan — React (implemented)

Covered in `src/test/menu.test.jsx`, driven by `bench.uploadRefused`, which
models `'always'` vs `'attached'` so both permission shapes are exercised:

- refusal is named as ours, not as a bad file
- no "try another file" on a permission refusal
- no doctype/role-permission language reaches a partner's screen
- a genuine parse failure **still** blames the file — the fix must not become a
  way of never telling someone their CSV is broken

## Gaps & follow-ups

1. **Run the probe.** Everything above is unverified.
2. **Second test account** for cross-tenant probes.
3. **No staging bench.** Every finding here is a production observation, which
   is why destructive probes are excluded.
4. **No Postman collection.** Worth generating one from the portal's service
   layer so this can run in CI rather than by hand.

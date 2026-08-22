# API Integration Clearance — venue upload journey

## Verdict

**CLEARED — via an endpoint switch, not a permission grant.**

The portal has been moved onto `shotright.api.upload_venue_photo`. Nothing about
the permission model changed, and nothing about it should.

## Scope & method

| | |
|---|---|
| Target | `shotright.thedaystar.co.za` |
| Mode | **LIVE, on-bench** (no gateway), verified by the backend 2026-08-22 |
| Prior run | STATIC — the QA environment's proxy refuses CONNECT to that host. Superseded. |

Everything below is **measured**, with one exception noted at the end.

## Findings

### ✅ RESOLVED — the 403 was structural, and permanent

| Probe | Result |
|---|---|
| `upload_file` + `doctype=Venue` | **403, permanent.** Vendors hold `["All","Guest"]`; `Venue` grants write to System Manager / Venue Reviewer only. |
| `upload_file`, no doctype | **200.** Menu import was never blocked. |
| Vendor `File` create | **Permitted** (role `All`). |
| `shotright.api.upload_venue_photo` | **Live, routable, real multipart upload as a vendor SUCCEEDED.** This is the fix. |

### ❌ Two things I asserted, refuted by measurement

1. **"The Vendor role cannot create a `File` at all."** Wrong. It can — role
   `All`. The menu importer's failure and the photo uploader's failure were
   never the same permission, and my §19.b table implying they were is wrong.

2. **"Grant `File` create to Vendor, and confirm the `Venue` attach grant is
   live."** ⚠️ **Retracted, and it was dangerous advice.** Frappe role
   permissions are **not row-scoped**. Granting Vendor write on `Venue` would
   have let every partner write every other partner's venue — a P0 introduced
   in the course of fixing a P1. The attach grant does not exist and must not be
   added. See `docs/PERMISSIONS.md`.

The recommendation that *was* right, and is now shipped, is the other one: a
whitelisted method that elevates internally. Three symptoms came from one
dependency on stock Frappe endpoints, and that dependency is gone.

### ✅ P0 sweep — clean

- **Cross-tenant attach:** BLOCKED (403).
- **Anonymous upload:** BLOCKED.

### ⚠️ P2 — open risk: `.HEIC` / `.avif` return 417 on a now-required field

Terminal, not retryable. It interacts badly with a change made the same day:
**a photo is now required to list a venue.** A partner whose only picture is a
HEIC — the iPhone default in "High Efficiency" — and who is told "something went
wrong" cannot list at all.

Handled in the portal, in two layers:

1. **In the browser**, `prepareImage` catches most HEIC before upload and gives
   iPhone-specific advice (Settings → Camera → Formats → Most Compatible).
2. **On a 417**, the message names it as a format problem, says JPEG and PNG
   work, and **does not offer a retry** — the same bytes would be refused the
   same way.

Deliberately **not** treated as "uploading is unavailable": a wrong format is
fixable by the partner in thirty seconds, so the photo requirement stays. Those
two are separate flags in the code (`retryable` vs `blocksUpload`) precisely
because conflating them would have switched the requirement off for a whole
session on one bad file.

## Clearance table

| Endpoint | Tier | Verdict | Conditions |
|---|---|---|---|
| `shotright.api.upload_venue_photo` | HIGH | **CLEARED** | Portal must send `venue_name`. Attachment verified. |
| `upload_file`, no doctype | HIGH | **CLEARED** | Wizard only, where no venue exists yet. |
| `upload_file` + `doctype=Venue` | — | **PERMANENTLY BLOCKED** | Never send it. Enforced in the fake bench so a regression fails in CI. |
| `get_venue_photos` | LOW | CLEARED | |

## Frontend contract — uploading a photo

| Situation | Endpoint | Why |
|---|---|---|
| Venue exists (edit form) | `upload_venue_photo` with `venue_name` | Elevates internally; attaches. |
| No venue yet (wizard step 2) | `upload_file`, **no doctype** | Nothing to attach to. `create_venue` links the `file_url`s. |

| Error | HTTP | Partner sees | Retry offered |
|---|---|---|---|
| Format refused | 417 | "isn't a format we can use", JPEG/PNG, iPhone setting | **No** |
| Permission | 403 | "our problem, not yours" | **No** — and the photo requirement lifts |
| Endpoint missing | 404 | same | **No** — requirement lifts |
| Network | — | "didn't upload… try again" | Yes |

## Gaps & follow-ups

1. **The auth hop is inferred, not measured** — the backend offered to mint a
   disposable vendor + API key and run the probes over the real stack. Worth
   taking up for one thing specifically: **the declared parameter name on
   `upload_venue_photo`.** The portal currently sends `venue_name`, `venue` and
   `docname` together, because Frappe drops undeclared kwargs silently at 200
   and a photo that uploads while attaching to nothing is exactly this
   project's recurring failure. One line of the signature retires that hedge.
2. **§14 is answerable now.** Can the Vendor role list `File` rows for its own
   venue? If not, `get_venue_photos` remains the only read path.
3. `qa/probe-upload.sh` is retained for regression use.

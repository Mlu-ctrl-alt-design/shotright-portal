#!/usr/bin/env bash
#
# Disambiguate the 403 on POST /api/method/upload_file.
#
# WHY THIS IS SIX REQUESTS AND NOT ONE. The portal makes two different uploads
# and BOTH fail. They differ in exactly one respect:
#
#   venue photos   send doctype=Venue & docname=VEN-…  → needs write on that
#                  Venue, AND create on File
#   menu import    send neither                        → needs create on File
#                  only
#
# So the pair below tells you which permission is actually missing, which is
# the whole question. Everything else here is the context you need to act on
# the answer without a second round trip.
#
# STATIC MODE: this was written without ever reaching the bench — this
# environment's egress is blocked. Nothing in the portal's issue tracker about
# this 403 is confirmed until you run this.
#
# Usage:
#   ./probe-upload.sh https://shotright.thedaystar.co.za KEY SECRET VEN-00001 [VEN-SOMEONE-ELSES]
#
# Read-only apart from the uploads themselves, which create File records named
# QA-PROBE-*. Delete those afterwards; nothing else is touched.

set -uo pipefail

BASE="${1:?base url}"
KEY="${2:?api key}"
SECRET="${3:?api secret}"
VENUE="${4:?a venue docname on THIS account}"
OTHER_VENUE="${5:-}"

AUTH="Authorization: token ${KEY}:${SECRET}"
TMP="$(mktemp -d)"
IMG="${TMP}/QA-PROBE-upload.png"

# Smallest valid PNG, so nothing fails for being a malformed image.
printf '\211PNG\r\n\032\n\000\000\000\rIHDR\000\000\000\001\000\000\000\001\010\006\000\000\000\037\025\304\211\000\000\000\nIDATx\234c\000\001\000\000\005\000\001\r\n-\262\000\000\000\000IEND\256B`\202' > "$IMG"

pass=0; fail=0
declare -A RESULT

probe () {
  local id="$1"; local label="$2"; shift 2
  echo
  echo "── ${id}  ${label}"
  local out; out="$(curl -sS -o "${TMP}/${id}.body" -w '%{http_code}' "$@" 2>&1)"
  local code="${out##*$'\n'}"
  RESULT["$id"]="$code"
  echo "   HTTP ${code}"
  echo "   ── response body (THIS is the thing nobody has captured yet) ──"
  # Frappe puts the real reason in `exception` and `_server_messages`. Print raw
  # rather than parsed: a jq that fails on an HTML error page hides the answer.
  head -c 1200 "${TMP}/${id}.body"; echo
}

echo "Probing ${BASE}"
echo "Venue under test: ${VENUE}"

# ---------------------------------------------------------------- A
# No doctype. This is the MENU IMPORT path. It asks only for File create.
probe A "upload_file WITHOUT doctype  (menu-import path — File create only)" \
  -X POST "${BASE}/api/method/upload_file" \
  -H "$AUTH" \
  -F "file=@${IMG};filename=QA-PROBE-nodoctype.png" \
  -F "is_private=1"

# ---------------------------------------------------------------- B
# With doctype. This is the VENUE PHOTO path. Adds write-on-Venue.
probe B "upload_file WITH doctype=Venue  (photo path — File create + Venue write)" \
  -X POST "${BASE}/api/method/upload_file" \
  -H "$AUTH" \
  -F "file=@${IMG};filename=QA-PROBE-attached.png" \
  -F "is_private=0" \
  -F "folder=Home/Attachments" \
  -F "doctype=Venue" \
  -F "docname=${VENUE}"

# ---------------------------------------------------------------- C
# Reading photos back is a DIFFERENT permission from attaching them (File read
# vs Venue write). §14 has been open on this since July.
probe C "get_venue_photos on your own venue  (the read half)" \
  -X GET "${BASE}/api/method/shotright.api.get_venue_photos?venue_name=${VENUE}" \
  -H "$AUTH"

# ---------------------------------------------------------------- D
# If this 200s, the Vendor role has File read and the portal can stop guessing.
probe D "frappe.client.get_list on File  (does the role see File at all?)" \
  -X GET "${BASE}/api/method/frappe.client.get_list?doctype=File&limit_page_length=1" \
  -H "$AUTH"

# ---------------------------------------------------------------- E
# SECURITY. Not part of the reported bug — worth one request while you are here.
# A 200 means any partner can attach files to any other partner's venue.
if [ -n "$OTHER_VENUE" ]; then
  probe E "upload_file attached to ANOTHER account's venue  (must be refused)" \
    -X POST "${BASE}/api/method/upload_file" \
    -H "$AUTH" \
    -F "file=@${IMG};filename=QA-PROBE-cross-tenant.png" \
    -F "is_private=0" \
    -F "doctype=Venue" \
    -F "docname=${OTHER_VENUE}"
else
  echo
  echo "── E  SKIPPED — pass a second venue docname owned by a DIFFERENT account."
  echo "      Cross-tenant attach is the one probe here that could find a P0,"
  echo "      and it is invisible without a second account."
fi

# ---------------------------------------------------------------- F
# No credentials at all. Anything but 401/403 is a P0.
probe F "upload_file with NO auth  (must be refused)" \
  -X POST "${BASE}/api/method/upload_file" \
  -F "file=@${IMG};filename=QA-PROBE-anon.png" \
  -F "is_private=1"

# ------------------------------------------------------------- verdict
echo
echo "════════════════════════════════════════════════════════════════"
echo " WHAT THE ANSWER MEANS"
echo "════════════════════════════════════════════════════════════════"
a="${RESULT[A]:-?}"; b="${RESULT[B]:-?}"; e="${RESULT[E]:-skipped}"; f="${RESULT[F]:-?}"

if [ "$a" = "403" ] && [ "$b" = "403" ]; then
  echo " A=403 and B=403 → the Vendor role cannot create a File AT ALL."
  echo "   The Venue attach grant added on 28 Jul is not the missing piece,"
  echo "   because A never asks for it. Fix: grant File create to Vendor, or"
  echo "   (preferred) add a whitelisted upload_venue_photo(venue_name, file)"
  echo "   that elevates internally, like every other shotright.api.* method."
elif [ "$a" != "403" ] && [ "$b" = "403" ]; then
  echo " A passed, B=403 → File create is fine; the VENUE attach permission is"
  echo "   missing or was applied to a different bench. The menu import should"
  echo "   already work — if partners say it does not, that is a second bug."
elif [ "$a" != "403" ] && [ "$b" != "403" ]; then
  echo " Both passed → the 403 is NOT a role permission on this account."
  echo "   Look at: file size limits (413), a validation hook (417), the"
  echo "   Vercel edge (a 403 with no Frappe exc_type in the body), or a"
  echo "   difference between this account and the reporting partner's."
else
  echo " Mixed/unclear — read the bodies above; Frappe names the doctype it"
  echo " refused in \`exception\`."
fi

[ "$f" = "403" ] || [ "$f" = "401" ] || echo " ⚠️  P0: unauthenticated upload returned ${f}, not 401/403."
[ "$e" = "403" ] || [ "$e" = "skipped" ] || echo " ⚠️  P0: attached a file to another account's venue (${e}). Ownership is not enforced."

echo
echo "Bodies saved in ${TMP} — attach them to the issue."
echo "Cleanup: delete any File records named QA-PROBE-*."

/**
 * Reconciling how the portal names a person with how the bench does.
 *
 * THE BUG THIS FIXES: the Settings page showed no name, and editing it did not
 * persist.
 *
 * The portal was written against `backend/api_reference.py`, which I wrote
 * before the real API existed and which invented a single `vendor_name` field.
 * The real API does not have one. `register_vendor` takes `first_name` and
 * `last_name` separately, and those are what actually get stored — so:
 *
 *   READ   the profile has no `vendor_name`, so "Your name" renders empty and
 *          the dashboard falls back to "Welcome back, Vendor".
 *   WRITE  the form posts `vendor_name` to `update_vendor_profile`. Frappe's
 *          `call()` filters kwargs down to the method's declared signature, so
 *          an argument the method does not accept is DROPPED SILENTLY — no
 *          error, HTTP 200, nothing saved. The UI then said "Profile updated."
 *
 * Both directions are handled here rather than in the views, so there is one
 * place to correct when the bench's actual shape is confirmed.
 *
 * ⚠️ NOT VERIFIED AGAINST THE LIVE BENCH — this environment has no outbound
 * route to shotright.thedaystar.co.za. The field list below is deliberately
 * generous for that reason, and `Profile.jsx` now re-reads after saving and
 * reports honestly if the value did not stick, rather than trusting a 200.
 */

/**
 * Every field the bench might plausibly carry a person's name in, most specific
 * first. `full_name` is a standard Frappe User field; `vendor_name` is what the
 * portal has always assumed.
 */
export function displayName(profile) {
  if (!profile) return ''
  const direct = profile.vendor_name || profile.full_name || profile.user_full_name
  if (direct) return String(direct).trim()

  const joined = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim()
  return joined
}

/**
 * Split a typed name into the first/last pair the bench stores.
 *
 * Everything before the first space is the first name, everything after is the
 * surname. That is wrong for some names and there is no rule that is right for
 * all of them — but it round-trips through `displayName()` unchanged, which is
 * the property that actually matters here: what someone types is what they see
 * afterwards.
 */
export function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first_name: '', last_name: '' }
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

/**
 * Give every consumer a `vendor_name` regardless of what the bench sent, so the
 * views do not each need to know about this mess.
 *
 * The original fields are preserved — this adds a derived one, it does not
 * replace anything.
 */
export function normaliseProfile(profile) {
  if (!profile) return profile
  return { ...profile, vendor_name: displayName(profile) }
}

/**
 * Build the update payload.
 *
 * Sends the name in BOTH shapes. This is deliberate, not shotgunning: Frappe
 * drops kwargs a whitelisted method does not declare, so the extra pair costs
 * nothing and cannot error — while sending only one shape is a coin flip that
 * fails silently with a 200 if it lands wrong. When the bench's real signature
 * is confirmed, delete the losing pair.
 *
 * `new_password` passes through untouched; it is the one field whose name the
 * portal has never been wrong about.
 */
export function toProfilePayload(form) {
  const { vendor_name, ...rest } = form
  if (vendor_name === undefined) return rest

  return {
    ...rest,
    vendor_name: vendor_name.trim(),
    ...splitName(vendor_name),
  }
}

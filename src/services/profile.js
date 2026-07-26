/**
 * Reconciling how the portal names a person with how the bench does.
 *
 * THE BUG THIS FIXES: the Settings page showed no name, and editing it did not
 * persist.
 *
 * The portal was written against `backend/api_reference.py`, which I wrote
 * before the real API existed and which invented a single `vendor_name` field.
 * The real signature, since confirmed, is:
 *
 *   shotright.api.update_vendor_profile(first_name, last_name, business_name,
 *                                       new_password)
 *     -> {first_name, last_name, business_name}
 *
 * No `vendor_name`. No `full_name`. So:
 *
 *   READ   the profile has no `vendor_name`, so "Your name" rendered empty and
 *          the dashboard said "Welcome back, Vendor".
 *   WRITE  the form posted `vendor_name`. Frappe's `call()` filters kwargs down
 *          to the method's declared signature, so an argument the method does
 *          not accept is DROPPED SILENTLY — no error, HTTP 200, nothing saved.
 *          The UI then reported "Profile updated."
 *
 * ⚠️ AND NO `phone`. The Settings form has a phone field with nowhere to send
 * it — see `Profile.jsx`, where it is now read-only rather than a control that
 * accepts input and discards it.
 *
 * The write below matches that signature exactly. The READ is still tolerant of
 * other shapes because `get_vendor_dashboard`'s `profile` payload has not been
 * confirmed the same way — it is near-certainly first/last given the above, but
 * the fallbacks cost nothing and a blank name is a bad way to find out.
 */

/**
 * Where a person's name might live, most specific first. `first_name` +
 * `last_name` is the confirmed shape; the other two are tolerated in case the
 * dashboard payload differs from the update payload.
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
 * The exact arguments `update_vendor_profile` accepts. Anything else Frappe
 * discards without complaint, so sending more is not harmless — it is how a
 * field silently fails to save while the request returns 200.
 */
const ACCEPTED = ['first_name', 'last_name', 'business_name', 'new_password']

/**
 * Build the update payload for the confirmed signature.
 *
 * `vendor_name` from the form is split into `first_name`/`last_name`. Nothing
 * outside `ACCEPTED` is sent: an earlier version posted both shapes as a hedge
 * while the signature was unknown, which is no longer a hedge but noise.
 *
 * `phone` is dropped here deliberately and the form no longer offers it for
 * editing — dropping it quietly while the field looked editable was the exact
 * failure mode this whole change is about.
 */
export function toProfilePayload(form) {
  const { vendor_name, ...rest } = form
  const named = vendor_name === undefined ? rest : { ...rest, ...splitName(vendor_name) }

  return Object.fromEntries(
    Object.entries(named).filter(([key, value]) => ACCEPTED.includes(key) && value !== undefined),
  )
}

/** Fields the bench can actually store, for the post-save verification. */
export const WRITABLE_PROFILE_FIELDS = ['vendor_name', 'business_name']

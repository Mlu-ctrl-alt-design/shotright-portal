/**
 * Smart defaults for "Enter your venue's details" — handoff spec, 27 Jul 2026.
 *
 * Three principles, from §1, which settle anything this file does not say:
 *   VISIBLE       the partner can see which values they typed and which we
 *                 supplied, without hunting.
 *   REVERSIBLE    one action returns a field to empty. Removing a guess must
 *                 never cost more than typing the value would have.
 *   NOT SILENTLY  where a wrong value has a real-world consequence, the default
 *   LOAD-BEARING  is a suggestion requiring confirmation, not a fait accompli.
 *
 * ---------------------------------------------------------------- TIERS (§3)
 *
 *   A  apply and commit    almost certainly right, cheap and obvious if wrong.
 *   B  apply and confirm    probably right, real downstream harm if wrong.
 *                           Submission blocked until edited or acknowledged.
 *   C  suggest              we know the population, not this venue.
 *   D  never default        guessing would embarrass us. Autofocus instead.
 *
 * ------------------------------------------------- WHAT THE BENCH CAN SUPPLY
 *
 * Two signals in the spec do not exist on the bench yet, and both are handled
 * by NOT defaulting rather than by approximating:
 *
 *   `session.user.phoneVerified` — there is no verification flag anywhere in
 *   the API. §9 is unambiguous: "Applying it would launder an unverified value
 *   into a customer-facing field through a UI that implies we checked it." So
 *   the contact-number default is DORMANT until the bench exposes a flag.
 *   `isPhoneVerified()` below is the single place to change when it does.
 *
 *   aggregate popularity — no endpoint. Absent payload means no default and no
 *   chip, which §9 already names as acceptable. Emphatically NOT the 62%/48%
 *   figures from the spec table: those are illustrative, and hard-coding them
 *   would put a fabricated statistic in front of partners as justification.
 *
 * A third gap is worth stating because it undercuts the payoff rather than the
 * mechanism: `create_venue` does not store manager name, surname or contact
 * number at all (see docs/BACKEND-INTEGRATION.md). Defaulting them saves typing
 * for fields the backend then drops. The defaults are still correct and still
 * reduce work; they just do not yet reach the database.
 */
import { splitName } from './profile'

export const TIER = { COMMIT: 'A', CONFIRM: 'B', SUGGEST: 'C', NEVER: 'D' }

export const SOURCE = {
  PROFILE: 'profile',
  POPULAR: 'popular',
  LOCATION: 'location',
}

/** §7 — chip copy is fixed. Longer phrasings need a layout check first. */
export const CHIP_COPY = {
  [SOURCE.PROFILE]: 'From your profile',
  [SOURCE.LOCATION]: 'Pin dropped from this address',
  popular: (share) => (share ? `Most venues pick this (${share}%)` : 'A common choice'),
}

/**
 * The field matrix (§4). `apply` returns the value to write, or undefined for
 * "no default available" — which is different from an empty string and must
 * stay that way, since an empty string would count as a value and get a chip.
 */
export const FIELD_MATRIX = {
  venue_name: { tier: TIER.NEVER },

  manager_name: {
    tier: TIER.COMMIT,
    source: SOURCE.PROFILE,
    label: 'manager name',
    apply: ({ profile }) => splitName(profile?.vendor_name).first_name || undefined,
  },

  manager_surname: {
    tier: TIER.COMMIT,
    source: SOURCE.PROFILE,
    label: 'manager surname',
    apply: ({ profile }) => splitName(profile?.vendor_name).last_name || undefined,
  },

  contact_number: {
    tier: TIER.CONFIRM,
    source: SOURCE.PROFILE,
    label: 'contact number',
    apply: ({ profile }) =>
      isPhoneVerified(profile) ? formatNational(profile.phone) : undefined,
  },

  dress_code: {
    tier: TIER.SUGGEST,
    source: SOURCE.POPULAR,
    label: 'dress code',
    apply: ({ popular }) => popular?.dress_code?.value || undefined,
    share: ({ popular }) => popular?.dress_code?.share,
  },

  atmosphere: {
    tier: TIER.SUGGEST,
    source: SOURCE.POPULAR,
    label: 'atmosphere',
    apply: ({ popular }) => popular?.atmosphere?.value || undefined,
    share: ({ popular }) => popular?.atmosphere?.share,
  },
}

/** Fields whose default blocks submission until edited or acknowledged (§3). */
export const TIER_B_FIELDS = Object.entries(FIELD_MATRIX)
  .filter(([, spec]) => spec.tier === TIER.CONFIRM)
  .map(([key]) => key)

/**
 * Is this profile's phone number verified?
 *
 * ⚠️ ALWAYS FALSE TODAY. The API exposes no verification flag, so the honest
 * answer is "we do not know", and §9 says an unknown-provenance number must not
 * be applied. The optional chains below are the shape to fill in once the bench
 * has one — do not relax this to `Boolean(profile?.phone)` to make the feature
 * demo better. That is precisely the laundering §9 forbids.
 */
export function isPhoneVerified(profile) {
  if (!profile?.phone) return false
  return Boolean(profile.phone_verified ?? profile.phoneVerified ?? profile.is_phone_verified)
}

/**
 * E.164 in, national grouping out — `+27 82 555 0134` (§4).
 *
 * South African numbers get the local grouping the spec shows. Anything else is
 * returned untouched rather than being reformatted by guesswork: a mangled
 * international number is worse than an unformatted one, and §9 requires long
 * international values to survive intact.
 */
export function formatNational(raw) {
  const value = String(raw || '').trim()
  if (!value) return undefined

  const digits = value.replace(/[^\d+]/g, '')
  const za = digits.match(/^\+27(\d{2})(\d{3})(\d{4})$/)
  if (za) return `+27 ${za[1]} ${za[2]} ${za[3]}`

  const local = digits.match(/^0(\d{2})(\d{3})(\d{4})$/)
  if (local) return `+27 ${local[1]} ${local[2]} ${local[3]}`

  return value
}

/**
 * Compute the defaults to apply, given the signals available right now.
 *
 * Pure: no state, no side effects, so the caller decides what to do with the
 * result and the whole matrix is testable without a DOM.
 *
 * `skip` carries fields excluded from application — dirty ones, and ones this
 * account has had suppressed (§6). The check happens HERE, at the moment of
 * application, not at mount, because a late geolocation fix must not overwrite
 * something touched in the meantime.
 */
export function computeDefaults({ profile, popular, values, skip = new Set() }) {
  const applied = {}

  for (const [key, spec] of Object.entries(FIELD_MATRIX)) {
    if (spec.tier === TIER.NEVER) continue
    if (skip.has(key)) continue

    // §9 browser autofill: anything already present at mount is treated as user
    // input. We do not overwrite it and we do not chip it, because we did not
    // put it there and claiming credit would be a lie about provenance.
    if (String(values?.[key] ?? '').trim()) continue

    const value = spec.apply({ profile, popular })
    if (value === undefined || value === '') continue

    applied[key] = {
      value,
      source: spec.source,
      tier: spec.tier,
      label: spec.label,
      share: spec.share?.({ profile, popular }),
    }
  }

  return applied
}

/**
 * The live-region sentence for a batch of applications (§11).
 *
 * One announcement, not one per field — six sequential interruptions is how a
 * screen-reader user learns to tune the region out.
 */
export function announcementFor(applied) {
  const entries = Object.values(applied)
  if (!entries.length) return ''

  const fromProfile = entries.filter((e) => e.source === SOURCE.PROFILE).length
  const fromPopular = entries.filter((e) => e.source === SOURCE.POPULAR).length

  const parts = []
  if (fromProfile) parts.push(`${count(fromProfile)} prefilled from your profile`)
  if (fromPopular) parts.push(`${count(fromPopular)} set to common defaults`)

  return `${parts.join(' and ')}. You can change any of them.`
}

const WORDS = ['zero', 'One field', 'Two fields', 'Three fields', 'Four fields', 'Five fields']
const count = (n) => WORDS[n] || `${n} fields`

/* ------------------------------------------------------------------ rollout */

/**
 * Rollout gate (§12): "behind a flag at 50% for two weeks before committing".
 *
 * `VITE_SMART_DEFAULTS` is `on` (default), `off`, or `50`. Bucketing is a
 * deterministic hash of the account email, so a partner does not flip between
 * arms on reload — an inconsistent form across sessions would be a worse
 * experience than either arm, and would make the A/B unreadable.
 *
 * ⚠️ The A/B this gates cannot be READ until `analytics.js` has a destination.
 */
export function smartDefaultsEnabled(accountKey) {
  const mode = import.meta.env.VITE_SMART_DEFAULTS || 'on'
  if (mode === 'off') return false
  if (mode !== '50') return true

  let hash = 0
  for (const char of String(accountKey || '')) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash % 2 === 0
}

/* --------------------------------------------------- dismissal preference */

/**
 * §6: dismissing a chip is not a preference signal unless the same field's
 * default is dismissed on three consecutive listings, after which it is
 * suppressed for that account.
 *
 * Kept in localStorage, deliberately: it is a convenience preference, not
 * partner data, and there is no endpoint to store it against the account. When
 * one exists, "a note is written to the account record" belongs there — this
 * becomes a cache in front of it, not the source of truth. Being per-device is
 * the known cost of the interim.
 */
const SUPPRESS_KEY = 'shotright.defaults.dismissals'
const SUPPRESS_AFTER = 3

const readDismissals = () => {
  try {
    return JSON.parse(localStorage.getItem(SUPPRESS_KEY) || '{}')
  } catch {
    return {}
  }
}

const writeDismissals = (data) => {
  try {
    localStorage.setItem(SUPPRESS_KEY, JSON.stringify(data))
  } catch {
    // Private-mode Safari throws. The feature degrades to "never suppressed",
    // which is the safe direction.
  }
}

/** Fields suppressed for this account because they were dismissed three times. */
export function suppressedFields(accountKey) {
  const all = readDismissals()[accountKey] || {}
  return new Set(Object.entries(all).filter(([, n]) => n >= SUPPRESS_AFTER).map(([key]) => key))
}

/** Record a dismissal. Returns true if this one crossed the suppression line. */
export function recordDismissal(accountKey, field) {
  const data = readDismissals()
  const account = (data[accountKey] ||= {})
  account[field] = (account[field] || 0) + 1
  writeDismissals(data)
  return account[field] === SUPPRESS_AFTER
}

/**
 * Clear a field's dismissal streak.
 *
 * "Three CONSECUTIVE listings" is the rule, so accepting a default has to reset
 * the count. Without this, three dismissals spread over a year of otherwise
 * happy use would suppress a default the partner mostly wants.
 */
export function clearDismissalStreak(accountKey, field) {
  const data = readDismissals()
  if (data[accountKey]?.[field]) {
    delete data[accountKey][field]
    writeDismissals(data)
  }
}

import { call, USE_MOCKS } from './api'
import { withFallback } from './vendor'

/**
 * What this account is entitled to — the portal's half of the Pro paywall.
 *
 * ============================================================================
 * THE ONE RULE: AN UNANSWERED QUESTION UNLOCKS. IT NEVER LOCKS.
 * ============================================================================
 *
 * Every path that cannot get a straight answer from the bench — endpoint not
 * deployed, a shape we do not recognise, a network failure — resolves to
 * EVERYTHING UNLOCKED. That is not timidity, it is the same rule the photo
 * requirement and the legal gate already follow in this codebase: never enforce
 * what the partner cannot resolve.
 *
 * Getting this backwards is not a small bug. A portal that locks on failure
 * shows a paying partner a paywall for something they have already bought, on a
 * screen with no way to prove otherwise, and the support conversation that
 * follows costs more than the R149. Worse, it does it to EVERY partner the
 * moment the bench hiccups — a monetisation feature that turns an outage into
 * an apparent mass downgrade.
 *
 * The backend made the same call from the other side: the cutoff lives in
 * `site_config`, unset means the paywall is off entirely, and an unparseable
 * value falls open. The two halves agree, which is the point.
 *
 * ============================================================================
 * WHY FEATURES ARE KEYS AND NOT `plan === 'pro'`
 * ============================================================================
 *
 * The Pro list went from three items to six while the screen was still being
 * designed. A portal that branches on the plan NAME has to be redeployed every
 * time that list moves; a portal that asks "is `bulk_import` on for this
 * account" does not. The bench stores entitlements as rows for exactly this
 * reason, so the portal reads them as rows.
 *
 * `plan` is still read, because the dialog has to say what they are being
 * offered — but nothing is ever GATED on it.
 *
 * ⚠️ THE RESPONSE SHAPE IS NOT YET CONFIRMED. `get_entitlements` landed on the
 * bench in PR #44 and, at the time of writing, is not reachable over HTTP —
 * gunicorn runs `--preload` and has not been restarted. So `normaliseEntitlements`
 * accepts every shape the endpoint might reasonably answer with rather than
 * betting on one, and the unrecognised case falls open like every other. When
 * the bench is restarted and the real shape is known, this function should get
 * SHORTER, not longer.
 */

export const ENTITLEMENTS_METHOD = 'shotright.api.get_entitlements'

/**
 * Feature keys, as the bench names them.
 *
 * ⚠️ Only `booking_analytics` is confirmed against the backend. The rest are
 * the portal's best reading of the Pro list and MUST be checked against the
 * registered rows before the paywall is switched on for real accounts — a key
 * that does not match a row reads as "not entitled", and the fall-open rule
 * does not save us here because the bench answered perfectly well, just about
 * a feature nobody registered.
 *
 * Gating a key the bench does not know is the one way this file can lock a
 * paying partner out, so it is worth one message to confirm the strings.
 */
export const FEATURE = {
  /** Import one venue from a Google Business Profile. */
  VENUE_IMPORT_GOOGLE: 'venue_import_google',
  /** Import one venue from a public Facebook or Instagram page. */
  VENUE_IMPORT_SOCIAL: 'venue_import_social',
  /** Import one venue from its own website. */
  VENUE_IMPORT_WEBSITE: 'venue_import_website',
  /** Many venues from one spreadsheet. */
  BULK_IMPORT: 'venue_bulk_import',
  /** Menu imported from a photo, PDF or spreadsheet. */
  MENU_IMPORT: 'menu_import',
  /** How many bookings each venue is taking, over time. */
  BOOKING_ANALYTICS: 'booking_analytics',
}

/**
 * The "import a venue from somewhere" group.
 *
 * ⚠️ There is no single `venue_import` row and there never was. The bench
 * registers three — Google, social and website — because they are three
 * different integrations that can be sold and switched off separately. A screen
 * offering "import from anywhere" holds the feature if it holds ANY of them,
 * which is what this is for.
 */
export const VENUE_IMPORT_FEATURES = [
  FEATURE.VENUE_IMPORT_GOOGLE,
  FEATURE.VENUE_IMPORT_SOCIAL,
  FEATURE.VENUE_IMPORT_WEBSITE,
]

/** What the upgrade dialog charges. One place, because it is said three times. */
export const PRO_PRICE = { amount: 'R149', cadence: 'per month' }

/**
 * Everything on. The answer whenever we could not get a real one.
 *
 * `known: false` is what separates "this bench has no paywall" from "this
 * account is on the free plan" — the UI uses it to stay quiet rather than
 * advertising an upgrade nobody can buy.
 */
const OPEN = { known: false, plan: null, features: null }

const asArray = (value) => (Array.isArray(value) ? value : [])

/**
 * Pull a set of enabled feature keys out of whatever the bench sent.
 *
 * Handles the four shapes `get_entitlements` could plausibly answer with:
 *
 *   ['venue_import', 'bulk_import']               bare keys
 *   [{key: 'venue_import', enabled: 1}, …]        rows, as the doctype holds them
 *   {venue_import: true, bulk_import: false}      a map
 *   {features: […], plan: 'Pro'}                  either of the above, wrapped
 *
 * Anything else returns null, which means "we did not understand this" and is
 * treated exactly like "we could not ask".
 */
const readFeatures = (raw) => {
  if (!raw) return null

  if (Array.isArray(raw)) {
    if (!raw.length) return new Set()
    if (typeof raw[0] === 'string') return new Set(raw.filter(Boolean))
    const rows = raw
      .filter((row) => row && typeof row === 'object')
      /* An explicit falsy `enabled`/`active` switches a row OFF. A row with
         neither field is a bare entitlement and counts as on — a doctype that
         only stores what is granted has no reason to carry a flag. */
      .filter((row) => {
        const flag = row.enabled ?? row.active ?? row.is_enabled
        return flag === undefined || flag === null || Boolean(Number(flag) || flag === true)
      })
      .map((row) => row.key || row.feature || row.feature_key || row.name)
      .filter(Boolean)
    return new Set(rows)
  }

  if (typeof raw === 'object') {
    return new Set(
      Object.entries(raw)
        .filter(([, value]) => value === true || Number(value) === 1)
        .map(([key]) => key),
    )
  }

  return null
}

export const normaliseEntitlements = (payload) => {
  if (!payload) return OPEN

  /**
   * The paywall switched off at the bench.
   *
   * The backend's gate reads a cutoff out of `site_config` and is inert when it
   * is unset, so a bench that answers "no gate" is telling us the feature is
   * not being sold here yet. That is a different state to "this partner has not
   * paid", and the only correct response to it is to show nobody a lock.
   */
  /**
   * ⚠️ FIELD NAMES CORRECTED 19 Sep, read off the live response.
   *
   * The bench sends `paywall_active`. It has never sent `gate_active`,
   * `paywall` or `enforced` — those were guesses made while the endpoint was
   * unreachable, so this branch never fired and a site with the paywall
   * switched off fell through to ordinary key matching.
   */
  if (payload.paywall_active === false || payload.gate_active === false) {
    return OPEN
  }

  /**
   * Grandfathered: this partner predates the paywall and keeps every feature,
   * permanently. The backend decides it from the Vendor Profile's creation date
   * against the cutoff, and EVERY partner on the live site is in this state
   * today. Showing them a lock is showing a paywall to somebody who has already
   * been told they will never see one.
   */
  if (payload.grandfathered === true) return OPEN

  const features = readFeatures(
    payload.features ?? payload.entitlements ?? payload.capabilities ?? payload,
  )
  if (!features) return OPEN

  return {
    known: true,
    // Lower-cased so 'Pro', 'PRO' and 'pro' are one plan rather than three.
    plan: String(payload.plan || payload.plan_name || payload.tier || '').toLowerCase() || null,
    features,
  }
}

/**
 * Ask the bench what this account can do.
 *
 * Never throws and never rejects: a failure here is a failure to ASK, and the
 * caller's only sane response to that is to unlock, so it is resolved into the
 * return value rather than left for every call site to remember.
 */
export const getEntitlements = async () => {
  if (USE_MOCKS) return OPEN

  try {
    return await withFallback(
      ENTITLEMENTS_METHOD,
      async () => normaliseEntitlements(await call(ENTITLEMENTS_METHOD)),
      async () => OPEN,
    )
  } catch (error) {
    /* A real error, not a missing method — a 403, a timeout, a 500. Logged for
       us, invisible to the partner, and it unlocks. See the rule at the top. */
    console.warn(
      '[shotright] could not read entitlements — everything is unlocked:',
      error?.message || error,
    )
    return OPEN
  }
}

/**
 * Is `feature` available on this account?
 *
 * Takes the whole entitlements object rather than a boolean so the fall-open
 * cases cannot be dropped on the floor by a caller writing `data?.features`.
 */
export const hasFeature = (entitlements, feature) => {
  if (!entitlements || !entitlements.known || !entitlements.features) return true
  return entitlements.features.has(feature)
}

/**
 * Begin a subscription, if the bench can take payment yet.
 *
 * ⚠️ AT THE TIME OF WRITING IT CANNOT. The Payfast adapter is still to be
 * built — `Vendor Subscription` and `Subscription Event` exist with nothing
 * feeding them — so this resolves to `{available: false}` and the dialog says
 * so in plain words.
 *
 * It is written as a real call rather than a `return false` so that the day the
 * adapter lands, the portal starts selling with no change on this side. Same
 * reasoning as every other `withFallback` here: the two halves ship separately
 * and neither waits for the other.
 *
 * Never throws — a checkout that cannot start is a sentence on screen, not a
 * stack trace over a payment flow.
 */
export const CHECKOUT_METHOD = 'shotright.api.start_subscription'

export const startCheckout = async () => {
  if (USE_MOCKS) return { available: false }

  try {
    return await withFallback(
      CHECKOUT_METHOD,
      async () => {
        const payload = await call(CHECKOUT_METHOD, { plan: 'pro' })
        const redirectUrl = payload?.redirect_url || payload?.url || payload?.checkout_url || null
        return redirectUrl ? { available: true, redirectUrl } : { available: false }
      },
      async () => ({ available: false }),
    )
  } catch (error) {
    console.warn('[shotright] could not start a subscription:', error?.message || error)
    return { available: false }
  }
}

/**
 * Did the BENCH refuse this call because of the paywall?
 *
 * The client-side check above decides what to show; this decides what to do
 * when the server disagrees with it — a partner whose subscription lapsed
 * between page load and submit, or a feature key the portal got wrong.
 *
 * The backend raises a dedicated exception subclassing `ValidationError`
 * precisely so clients can branch on `exc_type` instead of matching English
 * prose, which is what makes this a stable check rather than a fragile one.
 *
 * ⚠️ THE EXACT exc_type NAME IS NOT CONFIRMED. The pattern below covers the
 * plausible names; narrow it to the real one once the bench is restarted and
 * the exception has been seen on the wire. It is deliberately anchored to the
 * exc_type FIELD rather than to the message, so a venue whose description
 * happens to contain the word "upgrade" cannot trip it.
 */
const PAYWALL_EXC = /PlanRequired|EntitlementRequired|UpgradeRequired|SubscriptionRequired|PaywallError/i

export const isPaywalled = (error) => Boolean(error?.excType && PAYWALL_EXC.test(error.excType))

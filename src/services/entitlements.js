import { call, callGet } from './api'

/**
 * What this partner may use, and what it would cost to use more.
 *
 * ⚠️ READ THE DEFAULTS BEFORE ADDING A BANNER ANYWHERE.
 *
 * Today every live partner comes back `grandfathered: true` with all six paid
 * features and `upgrade_available: false`, because the site has no RevenueCat
 * keys and no cutoff date. In that state the honest thing for this portal to
 * render is **nothing**: an upgrade card shown to someone who already holds
 * every feature is telling them something untrue about their own account, over
 * a button that returns 417.
 *
 * So `shouldPromptUpgrade` below is the only thing a banner may gate on, and it
 * is false in every ambiguous case — loading, errored, grandfathered, paywall
 * off, nothing to sell. The same shape as `useLegalStanding().blocks`, and for
 * the same reason: a prompt that appears before the answer arrives is a lie
 * with good intentions.
 *
 * The three methods are live on the bench as of 18 Sep. No candidate-name list
 * here — unlike `legal.js`, these names were read off the deployed source
 * rather than guessed, and a fallback chain would only add dead 417s to a
 * partner's network tab.
 */
export const ENTITLEMENTS_METHOD = 'shotright.api.get_entitlements'
export const CHECKOUT_METHOD = 'shotright.api.get_upgrade_checkout'
export const REFRESH_METHOD = 'shotright.api.refresh_subscription'

/**
 * The exception the bench raises for a gated endpoint.
 *
 * Frappe puts the class name on the wire as `exc_type`, which is why the
 * backend gave this its own class rather than throwing a plain ValidationError:
 * the message is copy and a rewording would silently break any client matching
 * on the sentence.
 */
export const FEATURE_LOCKED = 'FeatureLockedError'

/** Is this error the paywall refusing, rather than anything else? */
export const isFeatureLocked = (error) => error?.excType === FEATURE_LOCKED

/**
 * An empty standing — what every caller gets when we could not ask.
 *
 * Deliberately NOT "nothing is entitled". An unanswered question must never
 * read as "you have lost your features": the portal would draw locks over a
 * paying partner's screen because one request timed out. `available: false`
 * is the signal, and every consumer treats it as "show nothing".
 */
const UNKNOWN = {
  available: false,
  features: [],
  gated: [],
  catalogue: {},
  grandfathered: false,
  paywallActive: false,
  upgradeAvailable: false,
  subscription: null,
  manageUrl: null,
  plans: [],
}

/**
 * One feature's copy, as the server holds it.
 *
 * Falls back to the key itself rather than to a table in this repo. A seventh
 * feature added on the bench should read a little raw here for one release, not
 * render as blank space — and never as a wrong label this portal invented.
 */
export const featureCopy = (standing, key) => ({
  key,
  label: standing?.catalogue?.[key]?.label || key,
  description: standing?.catalogue?.[key]?.description || '',
})

const normalise = (raw) => ({
  available: true,
  features: Array.isArray(raw?.features) ? raw.features : [],
  gated: Array.isArray(raw?.gated) ? raw.gated : [],
  catalogue: raw?.catalogue && typeof raw.catalogue === 'object' ? raw.catalogue : {},
  grandfathered: Boolean(raw?.grandfathered),
  paywallActive: Boolean(raw?.paywall_active),
  upgradeAvailable: Boolean(raw?.upgrade_available),
  subscription: raw?.subscription
    ? {
        plan: raw.subscription.plan || '',
        status: raw.subscription.status || '',
        periodEnd: raw.subscription.period_end || null,
        cancelAtPeriodEnd: Boolean(raw.subscription.cancel_at_period_end),
        paymentFailed: Boolean(raw.subscription.payment_failed),
      }
    : null,
  /* Top level, NOT inside `subscription` — a lapsed vendor has no subscription
     object at all, and they are exactly who needs somewhere to go. Null here
     means "no button", never an empty href. */
  manageUrl: raw?.management_url || null,
  plans: Array.isArray(raw?.plans) ? raw.plans : [],
})

export const getEntitlements = async () => {
  try {
    return normalise(await callGet(ENTITLEMENTS_METHOD, {}))
  } catch (error) {
    console.warn(
      `[shotright] ${ENTITLEMENTS_METHOD} answered ${error?.status || 'an error'}: ` +
        `${error?.message || 'no message'}. No locks and no upgrade prompts will be ` +
        `drawn — the cautious direction.`,
    )
    return { ...UNKNOWN, errored: true, error }
  }
}

/** Does this partner hold this feature? Unknown answers yes — see UNKNOWN. */
export const hasFeature = (standing, key) => {
  if (!standing?.available) return true
  if (!standing.gated.includes(key)) return true
  return standing.features.includes(key)
}

/**
 * May the portal prompt this partner to upgrade at all?
 *
 * Every clause is a way of being wrong that a real partner would see:
 *
 *   available        — we could not ask; do not guess about someone's billing
 *   !grandfathered   — they hold everything already; an offer is an insult
 *   paywallActive    — the site has no cutoff, so nothing is gated for anyone
 *   upgradeAvailable — no RevenueCat keys, so the button cannot succeed
 */
export const shouldPromptUpgrade = (standing) =>
  Boolean(
    standing?.available &&
      !standing.grandfathered &&
      standing.paywallActive &&
      standing.upgradeAvailable,
  )

/** Where to send a partner to buy `plan`. */
export const getUpgradeCheckout = async (plan) => await call(CHECKOUT_METHOD, { plan })

/** Re-read the subscription from RevenueCat. POST: it writes. */
export const refreshSubscription = async () => await call(REFRESH_METHOD, {})

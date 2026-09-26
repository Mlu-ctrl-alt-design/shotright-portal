import { call, callGet, USE_MOCKS } from './api'
import { withFallback } from './vendor'
import { submitPayfastForm } from './plan'

/**
 * Sponsored listings: pay to put one of your Approved venues at the top of
 * nearby discovery results for 1–4 weeks (shotright PR #61).
 *
 * What the bench guarantees, and this file relies on:
 *  - Price is flat per week and comes from the bench (`price_per_week`); the
 *    portal never computes what a partner is charged, it only multiplies for
 *    display. The charge itself is whatever `start_promotion` sends Payfast.
 *  - `can_promote: false` always carries a `reason` code — see REASONS.
 *  - A promotion is live from `starts_on` to `ends_on` once PAID. Unpaid
 *    checkouts are never listed back.
 *  - Customers see a "Sponsored" label on the card. Surprise Me is never
 *    sponsored.
 */
export const OFFER_METHOD = 'shotright.api.get_promotion_offer'
export const START_METHOD = 'shotright.api.start_promotion'
export const LIST_METHOD = 'shotright.api.get_venue_promotions'

/** What each refusal means to a partner. */
export const REASONS = {
  not_approved: 'Only an approved, live venue can be promoted. Once this venue is approved you can promote it here.',
  rating_too_low:
    'Guest ratings for this venue are too low to promote it right now. Promotion opens again once the average recovers.',
  payments_unavailable: 'Payments aren’t switched on yet, so promotions can’t be bought right now.',
}

/**
 * @returns `{available, errored?, offer?}`. `available: false` means the bench
 * has no promotions yet — not that this venue can't be promoted.
 */
export const getPromotionOffer = async (venueId) => {
  if (USE_MOCKS) return { available: false }
  try {
    const offer = await withFallback(
      OFFER_METHOD,
      () => callGet(OFFER_METHOD, { venue_name: venueId }),
      async () => undefined,
    )
    return offer === undefined ? { available: false } : { available: true, offer }
  } catch (error) {
    return { available: false, errored: true, error }
  }
}

export const getVenuePromotions = async (venueId) => {
  if (USE_MOCKS) return []
  const payload = await withFallback(
    LIST_METHOD,
    () => callGet(LIST_METHOD, { venue_name: venueId }),
    async () => ({ promotions: [] }),
  )
  return payload?.promotions || []
}

/**
 * Create the promotion and hand the partner to Payfast. On success the page
 * navigates away, so the caller only ever sees a rejection (the bench's own
 * message: an overlap, a window out of range, a venue that can't be promoted).
 */
export const startPromotion = async ({ venueId, weeks, startsOn, moods = [] }) => {
  const args = { venue_name: venueId, weeks }
  if (startsOn) args.starts_on = startsOn
  if (moods.length) args.moods = JSON.stringify(moods)
  const payload = await call(START_METHOD, args)
  if (payload?.method === 'POST' && payload.action && payload.fields) {
    submitPayfastForm(payload.action, payload.fields)
    return { redirected: true, promotion: payload.promotion }
  }
  throw new Error('We couldn’t start the payment. Please try again.')
}

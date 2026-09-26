import { call, callGet, USE_MOCKS } from './api'
import { withFallback } from './vendor'

/**
 * Ratings customers left after a booked visit, and the venue's replies.
 *
 * Backend: shotright PR #57 — `get_venue_ratings` and `reply_to_venue_rating`.
 * Named "ratings" throughout, never "review": `venueReview.js` and
 * `VenueReview.jsx` are the admin approval of a venue, a different thing.
 *
 * What the bench guarantees, and this file relies on:
 *  - Only customers who booked can rate, once per booking, 1–5 whole stars.
 *  - The customer arrives as a FIRST NAME only. No email, no phone.
 *  - `average` is the venue's own raw average, even below the public threshold
 *    (`rating`, which customers see, stays null until 3 ratings).
 *  - A rating Sho't Right has hidden comes back `is_flagged: true` with its
 *    comment withheld, and cannot be replied to.
 *  - One reply per rating. Saving again replaces it; the customer is told in
 *    their app on the first reply only.
 */
export const RATINGS_METHOD = 'shotright.api.get_venue_ratings'
export const REPLY_METHOD = 'shotright.api.reply_to_venue_rating'

export const RATINGS_PAGE = 20
/** The bench caps a page at 100; asking for more is clamped, so we don't. */
export const RATINGS_MAX_PAGE = 100
export const MAX_REPLY_LENGTH = 1000
/** Mirrors the bench's MIN_RATINGS_TO_SHOW, for the "customers see…" note. */
export const PUBLIC_THRESHOLD = 3

const normaliseRow = (raw) => ({
  id: raw.name,
  score: Number(raw.score) || 0,
  comment: raw.comment || '',
  firstName: raw.customer_first_name || '',
  visitDate: raw.visit_date || '',
  submittedOn: raw.submitted_on || '',
  reply: raw.reply || '',
  repliedOn: raw.replied_on || '',
  flagged: !!raw.is_flagged,
})

/**
 * @returns `{available, errored, average, count, publicRating, unreplied,
 *            ratings, total}`.
 *
 * `available: false` means the bench cannot answer — NOT "no ratings yet". The
 * two must never render the same, for the reason bookings.js gives.
 */
export const getVenueRatings = async (venueId, { limit = RATINGS_PAGE, unrepliedOnly = false } = {}) => {
  if (USE_MOCKS) {
    return { available: true, average: null, count: 0, publicRating: null, unreplied: 0, ratings: [], total: 0 }
  }

  const params = { venue_name: venueId, start: 0, limit: Math.min(limit, RATINGS_MAX_PAGE) }
  if (unrepliedOnly) params.unreplied_only = 1

  let payload
  try {
    payload = await withFallback(
      RATINGS_METHOD,
      () => callGet(RATINGS_METHOD, params),
      async () => undefined,
    )
  } catch (error) {
    return { available: false, errored: true, error, ratings: [] }
  }
  if (payload === undefined) return { available: false, ratings: [] }

  return {
    available: true,
    average: payload.average ?? null,
    count: Number(payload.rating_count) || 0,
    publicRating: payload.rating ?? null,
    unreplied: Number(payload.unreplied) || 0,
    ratings: (payload.ratings || []).map(normaliseRow),
    total: Number(payload.total) || 0,
  }
}

/** Set or replace the venue's reply. Rejects with the bench's own message. */
export const replyToRating = (ratingId, reply) => call(REPLY_METHOD, { rating: ratingId, reply })

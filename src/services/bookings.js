import { call, callGet, USE_MOCKS } from './api'
import { withFallback } from './vendor'

/**
 * Bookings for a venue.
 *
 * ⚠️ TWO THINGS TO KNOW BEFORE READING THIS FILE.
 *
 * 1. **The PRD puts bookings management out of scope** ("Payments, partner
 *    tiers and packages, customer-facing features, bookings management"). It
 *    was asked for on 28 Jul, which overrides that — but the exclusion is why
 *    there is no design, no doctype and no endpoint to build against.
 * 2. **Nothing on the bench serves this yet.** Not one candidate name below is
 *    known to exist.
 *
 * So this is written the way every other unshipped capability on this project
 * has been: a list of plausible method names, tried in order, and a screen that
 * says plainly it cannot see bookings rather than showing an empty table that
 * reads as "you have no bookings". Those two are completely different messages
 * to a restaurant owner, and the difference is the whole point.
 *
 * When the backend picks a name and a shape, the tab starts working with no
 * frontend release. If it picks a name that isn't in the list, add it here —
 * that is a one-line change, and it is cheaper than being wrong about which
 * name to hard-code, which has cost this project six bugs.
 */
export const BOOKING_METHODS = [
  'shotright.api.get_venue_bookings',
  'shotright.api.list_venue_bookings',
  'shotright.api.get_bookings',
]

/**
 * One booking, normalised.
 *
 * Every field is optional because we have no schema. A booking with no name is
 * still a booking somebody has to honour, so nothing is dropped for being
 * incomplete — it is shown with what it has.
 */
const normalise = (raw, index) => ({
  id: raw?.name || raw?.booking_id || raw?.id || `booking-${index}`,
  when: raw?.booking_datetime || raw?.datetime || raw?.date || raw?.starts_on || '',
  guest: raw?.customer_name || raw?.guest_name || raw?.customer || raw?.contact_name || '',
  phone: raw?.phone || raw?.contact_number || raw?.mobile_no || '',
  people: Number(raw?.party_size ?? raw?.guests ?? raw?.people ?? raw?.no_of_guests) || null,
  status: raw?.status || raw?.workflow_state || '',
  note: raw?.notes || raw?.special_requests || raw?.remarks || '',
})

/**
 * @returns `{available, bookings, method}`.
 *
 * `available: false` means the bench cannot answer — NOT that the venue has no
 * bookings. Rendering those two the same way is the mistake that made a
 * declined venue say "no reason was recorded" over a reason we already had.
 */
export const getVenueBookings = async (venueId) => {
  if (USE_MOCKS) {
    const rows = (await import('./mockBackend')).mockBackend.getVenueBookings?.(venueId)
    const list = (await rows) || []
    return { available: true, bookings: list.map(normalise) }
  }

  for (const method of BOOKING_METHODS) {
    let payload
    try {
      payload = await withFallback(
        method,
        async () => await callGet(method, { venue_name: venueId }),
        async () => undefined,
      )
    } catch {
      // Deployed and raising. Not a capability answer — say we can't see them
      // rather than putting an exception on a partner's booking sheet.
      return { available: false, bookings: [], method, errored: true }
    }
    if (payload === undefined) continue

    const rows = Array.isArray(payload) ? payload : payload?.bookings || payload?.data || []
    return { available: true, bookings: rows.map(normalise), method }
  }

  return { available: false, bookings: [] }
}

/**
 * The two things a partner does to a booking.
 *
 * Not wired to a screen yet — there is nowhere to send them. Kept here, unused
 * and honest about it, so that when the endpoints land the shape of the ask is
 * already written down rather than reinvented under time pressure.
 */
export const BOOKING_WRITE_METHODS = {
  confirm: ['shotright.api.confirm_booking', 'shotright.api.accept_booking'],
  decline: ['shotright.api.decline_booking', 'shotright.api.cancel_booking'],
}

export const setBookingStatus = async (bookingId, action) => {
  const methods = BOOKING_WRITE_METHODS[action] || []
  for (const method of methods) {
    const result = await withFallback(
      method,
      async () => (await call(method, { booking: bookingId, name: bookingId })) ?? { ok: true },
      async () => undefined,
    )
    if (result !== undefined) return { done: true, method }
  }
  return { done: false, reason: 'no-endpoint' }
}

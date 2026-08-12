import { call, callGet, USE_MOCKS } from './api'
import { withFallback } from './vendor'

/**
 * Bookings for a venue.
 *
 * SHIPPED 7 Aug — `shotright.api.get_venue_bookings`, wrapping
 * `booking_service.get_venue_bookings(vendor_email, venue_name, from_date,
 * to_date, limit)`. Identity comes from the session, ownership is checked
 * against `Venue.vendor` before a row is read, and there is no email parameter,
 * so ADR-0004 holds and nothing about how we authenticate changes.
 *
 *   { name, arrival_date, arrival_time, adults, children, party_size,
 *     contact_name, contact_cell_phone, creation }
 *
 * FOUR THINGS THE SHAPE TELLS US, each of which this file has to respect:
 *
 * 1. **Date and time are separate fields**, not one datetime. `arrival_date` is
 *    a plain `YYYY-MM-DD` with no zone, so "today" must be computed in local
 *    time — `toISOString()` would silently show tomorrow's list to anyone
 *    opening the portal before 02:00 SAST.
 * 2. **`party_size` is computed server-side** and is the number to trust.
 *    `booking_register.py` computes it the same way; two surfaces disagreeing
 *    about whether children count toward covers is exactly the bug worth not
 *    having, so we never re-derive it when it is present.
 * 3. **There is no status.** Bookings are not gated on `workflow_state` either
 *    — a venue sent back to Pending on Thursday still has guests arriving
 *    Friday. So there is nothing to badge, and inventing "Confirmed" would be
 *    us telling a partner something the server never said.
 * 4. **No `contact_email`.** Deliberate: the customer gave it to receive their
 *    own confirmation, which `create_booking` already sent. Name and cell are
 *    what running a door needs.
 *
 * The candidate list stays. It costs one array and it is how this tab worked on
 * the day the endpoint landed with no frontend release.
 */
export const BOOKING_METHODS = [
  'shotright.api.get_venue_bookings',
  'shotright.api.list_venue_bookings',
  'shotright.api.get_bookings',
]

/** Server caps at 500; asking for more just gets clamped, so we ask honestly. */
export const BOOKING_LIMIT = 100

/**
 * Today, in the browser's own timezone.
 *
 * NOT `toISOString().slice(0, 10)`. That is UTC, and South Africa is UTC+2, so
 * between midnight and 02:00 it returns yesterday — the exact hours a late
 * venue is still open and most likely to be checking tomorrow's book.
 */
export const localDate = (offsetDays = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * One booking, normalised.
 *
 * The aliases beyond the shipped names are not hedging about a schema we now
 * have — they are there because `get_venue_bookings` is one of three candidate
 * methods and the other two, if they ever answer, will not have been written to
 * match. Real names are checked first in every case.
 */
const normalise = (raw, index) => {
  const adults = Number(raw?.adults) || 0
  const children = Number(raw?.children) || 0
  const server = Number(raw?.party_size ?? raw?.guests ?? raw?.people ?? raw?.no_of_guests)

  return {
    id: raw?.name || raw?.booking_id || raw?.id || `booking-${index}`,
    date: raw?.arrival_date || raw?.date || '',
    time: raw?.arrival_time || '',
    guest: raw?.contact_name || raw?.customer_name || raw?.guest_name || raw?.customer || '',
    phone: raw?.contact_cell_phone || raw?.phone || raw?.contact_number || raw?.mobile_no || '',
    /* Server first, always. The sum is only for a shape that never sent one. */
    people: Number.isFinite(server) && server > 0 ? server : adults + children || null,
    adults,
    children,
    bookedOn: raw?.creation || '',
    /* Not returned today. Kept so that if a status ever appears we show it
       rather than dropping it — but never faked when it is absent. */
    status: raw?.status || raw?.workflow_state || '',
    note: raw?.notes || raw?.special_requests || raw?.remarks || '',
  }
}

/** Earliest first — a service runs forwards through the evening. */
const byArrival = (a, b) =>
  `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)

/**
 * @param venueId  the Venue docname. Ownership is enforced on the server.
 * @param range    `{from, to}` as `YYYY-MM-DD`; both inclusive, both optional
 *                 and independent.
 *
 * @returns `{available, bookings, method, errored, truncated}`.
 *
 * `available: false` means the bench could not answer — NOT that the venue has
 * no bookings. Rendering those two the same way is the mistake that made a
 * declined venue say "no reason was recorded" over a reason we already had.
 * `errored` separates the two ways of not answering: a method that is missing
 * is a deployment gap, a method that throws is a bad minute.
 */
export const getVenueBookings = async (venueId, range = {}) => {
  const params = { venue_name: venueId, limit: BOOKING_LIMIT }
  if (range.from) params.from_date = range.from
  if (range.to) params.to_date = range.to

  if (USE_MOCKS) {
    const rows = (await import('./mockBackend')).mockBackend.getVenueBookings?.(venueId, range)
    const list = (await rows) || []
    return { available: true, bookings: list.map(normalise).sort(byArrival) }
  }

  for (const method of BOOKING_METHODS) {
    let payload
    try {
      payload = await withFallback(
        method,
        async () => await callGet(method, params),
        async () => undefined,
      )
    } catch (error) {
      // Deployed and raising. Not a capability answer — say we can't see them
      // rather than putting an exception on a partner's booking sheet.
      return { available: false, bookings: [], method, errored: true, error }
    }
    if (payload === undefined) continue

    const rows = Array.isArray(payload) ? payload : payload?.bookings || payload?.data || []
    return {
      available: true,
      bookings: rows.map(normalise).sort(byArrival),
      method,
      /* A full page is indistinguishable from "there are exactly 100" — so we
         say which one we can't tell apart rather than implying the list ends. */
      truncated: rows.length >= BOOKING_LIMIT,
    }
  }

  return { available: false, bookings: [] }
}

/**
 * The two things a partner does to a booking.
 *
 * Still not wired to a screen — `get_venue_bookings` is read-only and there is
 * no confirm/decline endpoint. Kept here, unused and honest about it, so the
 * shape of the ask is written down rather than reinvented under time pressure.
 * A confirm button that reaches nobody is worse than no button.
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

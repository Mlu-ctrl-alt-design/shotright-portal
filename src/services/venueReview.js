import { callGet, call, USE_MOCKS, isMethodMissing } from './api'
import { mockBackend } from './mockBackend'
import { withFallback } from './vendor'

/**
 * What the moderator said, and what to do about it.
 *
 * A decline is the only moment in this product where the partner is not the one
 * driving. They submitted a venue, waited, and were told no. Everything on the
 * screen this feeds exists to answer one question — *why, and what do I change?*
 *
 * THE HONEST FAILURE MODE MATTERS MORE THAN THE HAPPY ONE. The bench currently
 * has no field for a moderator to write into, so for now every decline comes
 * back with no reason attached. That is a bad thing to discover, and the
 * temptation is to soften it with a generic "your venue didn't meet our
 * guidelines". We don't: a made-up reason is worse than an admitted absence,
 * because a partner will act on it, change the wrong thing, and be declined
 * again. `available: false` is reported as exactly what it is.
 */
export const REVIEW_READ_METHOD = 'shotright.api.get_venue_review'
export const FIX_ITEM_METHOD = 'shotright.api.set_review_fix_item'

/**
 * Where "Contact support" goes.
 *
 * Deliberately NOT defaulted to a guessed address. Every invented string on
 * this project — `vendor_name`, `Rejected`, five menu method names — became a
 * bug that reached a partner, and a support address nobody has confirmed is
 * the worst of them: a message to it does not bounce loudly, it just never
 * gets read. Unset means the button is not shown and the screen says so.
 */
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || ''

const FIX_STORE = 'shotright.fixItems'

const readStore = () => {
  try {
    return JSON.parse(localStorage.getItem(FIX_STORE) || '{}')
  } catch {
    return {}
  }
}

/**
 * The review, normalised.
 *
 * `available` distinguishes "the endpoint isn't deployed" from "the moderator
 * left no note", which look identical to the partner and are completely
 * different to us — one is our bug, the other is a process gap.
 */
const normalise = (raw, available) => {
  const notes = String(raw?.notes || raw?.review_notes || '').trim()
  return {
    available,
    notes,
    reviewedBy: raw?.reviewed_by_name || raw?.reviewed_by || '',
    reviewedOn: raw?.reviewed_on || raw?.modified || '',
    state: raw?.state || raw?.workflow_state || '',
    fixItems: (raw?.fix_items || []).map((item, index) => ({
      key: item.name || item.key || `item-${index}`,
      label: item.label || item.description || String(item),
      done: Boolean(item.done),
    })),
  }
}

export const getVenueReview = (venueId) =>
  USE_MOCKS
    ? mockBackend.getVenueReview(venueId).then((raw) => normalise(raw, true))
    : withFallback(
        REVIEW_READ_METHOD,
        async () => normalise(await callGet(REVIEW_READ_METHOD, { venue_name: venueId }), true),
        async () => normalise(null, false),
      )

/**
 * Tick a fix item off.
 *
 * Falls back to this browser, like drafts do — the checklist is the partner's
 * working notes, and losing them on another device is a smaller harm than not
 * being able to keep track at all. It is not, and must not be presented as,
 * something the reviewer can see.
 */
export const setFixItemDone = async (venueId, key, done) => {
  if (!USE_MOCKS) {
    try {
      await call(FIX_ITEM_METHOD, { venue_name: venueId, item: key, done: done ? 1 : 0 })
      return { synced: true }
    } catch (err) {
      if (!isMethodMissing(err, FIX_ITEM_METHOD)) throw err
    }
  }
  const store = readStore()
  store[venueId] = { ...(store[venueId] || {}), [key]: done }
  localStorage.setItem(FIX_STORE, JSON.stringify(store))
  return { synced: false }
}

export const localFixState = (venueId) => readStore()[venueId] || {}

/* --------------------------------------------------------------- our own */

/**
 * Gaps in the listing that we can see without being told.
 *
 * These are NOT the reviewer's reasons and the screen must never present them
 * as such — that is why they come from a separate function, render under their
 * own heading, and are worded as observations rather than instructions from
 * anybody. But they are the four or five things a listing is actually declined
 * for, they are checkable from data already on the page, and when the reviewer
 * left no note they are the only concrete thing we can offer.
 *
 * Ordered by how much each one costs the partner. A venue with no coordinates
 * cannot be found by anyone at all; a missing dress code is cosmetic.
 */
export function deriveGaps(venue, { photos = [], menu = [] } = {}) {
  const gaps = []
  const text = (value) => String(value || '').replace(/<[^>]*>/g, '').trim()

  if (!Number.isFinite(venue?.latitude) || !Number.isFinite(venue?.longitude)) {
    gaps.push({
      key: 'location',
      label: 'No location is set',
      detail:
        'Customers find venues by searching near themselves, so a venue with no pin never appears — whatever else is on it.',
      to: 'edit',
    })
  }

  if (!(venue?.moods || []).length) {
    gaps.push({
      key: 'moods',
      label: 'No moods are set',
      detail: 'Sho’t Right searches by mood. A venue with none cannot be matched to anything.',
      to: 'edit',
    })
  }

  if (!photos.length) {
    gaps.push({
      key: 'photos',
      label: 'No photos',
      detail:
        'A listing with no picture asks someone to pick where to spend their evening on a name alone.',
      to: 'edit',
    })
  }

  const itemCount = menu.reduce((n, heading) => n + (heading.items?.length || 0), 0)
  if (!itemCount) {
    gaps.push({
      key: 'menu',
      label: 'Nothing on the menu',
      detail: 'Even a handful of items and prices gives someone a reason to choose you.',
      to: 'menu',
    })
  }

  if (!text(venue?.atmosphere_desc) && !text(venue?.summary)) {
    gaps.push({
      key: 'description',
      label: 'No description',
      detail: 'A line or two about what a night here is like.',
      to: 'edit',
    })
  }

  return gaps
}

/**
 * A prefilled support email.
 *
 * Carries the venue id and the decline date because the first two replies of
 * any support thread are otherwise "which venue?" and "when?". The partner's
 * own message goes at the top, where they will type it, not appended under a
 * block of metadata they have to scroll past.
 */
export function supportMailto({ venueName, venueId, reviewedOn, message = '' }) {
  if (!SUPPORT_EMAIL) return null
  const body = [
    message,
    '',
    '---',
    `Venue: ${venueName || venueId}`,
    `Reference: ${venueId}`,
    reviewedOn ? `Declined on: ${new Date(reviewedOn).toLocaleDateString('en-ZA')}` : null,
  ]
    .filter((line) => line !== null)
    .join('\n')

  return (
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(`Declined venue: ${venueName || venueId}`)}` +
    `&body=${encodeURIComponent(body)}`
  )
}

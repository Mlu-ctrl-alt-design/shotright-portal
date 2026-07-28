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
 * THE HONEST FAILURE MODE MATTERS MORE THAN THE HAPPY ONE. Where a reason
 * genuinely wasn't recorded we say so, rather than softening it with a generic
 * "your venue didn't meet our guidelines" — a made-up reason is worse than an
 * admitted absence, because a partner acts on it, changes the wrong thing, and
 * is declined again.
 *
 * ⚠️ CORRECTED 28 JUL — AND THE CORRECTION IS THE INTERESTING PART.
 *
 * This file was written believing the bench had no field for a moderator to
 * write into. It has had three all along: `review_notes`, `reviewed_by` and
 * `reviewed_on` are on the `Venue` doctype, and `get_vendor_dashboard` has been
 * returning them to this portal the entire time — put there deliberately so a
 * declined venue could render its reasons without a second round trip.
 *
 * So the portal was printing "No reason was recorded" on top of a reason it had
 * already been handed. The capability check was sound and the answer it gave
 * was true — `get_venue_review` really isn't deployed — but it was the answer
 * to a question that didn't need asking. A missing ENDPOINT was reported to the
 * partner as missing DATA.
 *
 * The lesson generalises past this screen: check what you already hold before
 * you ask whether you can get it. The read order below does that.
 *
 *   1. `get_venue_review` — if ever deployed, the richest source, and the only
 *      one that can carry `fix_items`.
 *   2. THE VENUE RECORD WE ALREADY HAVE. This is the one that works today.
 *   3. The dashboard row — for the case where `get_venue_detail` doesn't pass
 *      the review fields through but `get_vendor_dashboard` does.
 *
 * First source actually carrying the field wins. Nothing needs to be deployed
 * for a partner to read why they were declined.
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
 * Does this payload carry review fields at all?
 *
 * The distinction that matters is between a field that is PRESENT AND EMPTY —
 * nobody wrote a note — and a field that isn't in the payload, meaning whatever
 * we read simply doesn't pass it through. To the partner both render as
 * silence; to us one is a process gap and the other is our own plumbing, and we
 * must not blame the reviewer for the second.
 *
 * Frappe sends an empty Small Text as `""` or `null`, so presence of the KEY is
 * the test — never truthiness of the value.
 */
const carriesReview = (raw) =>
  Boolean(raw) &&
  ['notes', 'review_notes', 'reviewed_on', 'reviewed_by'].some((key) => key in raw)

/**
 * The review, normalised.
 *
 * `available` now means "we could read the review fields", NOT "an endpoint
 * answered" — those came apart the moment we learned the fields ride along on
 * the venue record. `source` names where it came from, so a bug report can say
 * which of three paths produced the screen someone is looking at.
 */
const normalise = (raw, source) => {
  const notes = String(raw?.notes ?? raw?.review_notes ?? '').trim()
  return {
    available: source !== 'none',
    source,
    notes,
    reviewedBy: raw?.reviewed_by_name || raw?.reviewed_by || '',
    reviewedOn: raw?.reviewed_on || '',
    state: raw?.state || raw?.workflow_state || '',
    fixItems: (raw?.fix_items || []).map((item, index) => ({
      key: item.name || item.key || `item-${index}`,
      label: item.label || item.description || String(item),
      done: Boolean(item.done),
    })),
  }
}

/**
 * `reviewed_on` used to fall back to `modified`. It must not.
 *
 * The bench stamps `reviewed_on` on the workflow TRANSITION, so it means "the
 * day someone decided". `modified` means "the day the row last changed" — which
 * a moderator opening the doc in October will move, and the screen renders it
 * as "· 12 October" under the reviewer's name. A partner declined in July would
 * read that as having been judged again. A missing date is better than a wrong
 * one, so an absent `reviewed_on` now shows no date at all.
 */

/**
 * @param venueId  the docname
 * @param venue    the venue record the calling screen already holds, if any.
 *                 Passing it is what makes this work with nothing deployed.
 */
export const getVenueReview = async (venueId, venue = null) => {
  if (USE_MOCKS) return normalise(await mockBackend.getVenueReview(venueId), 'endpoint')

  // 1. The dedicated endpoint, if it is ever deployed. Only source of fix_items.
  const fromEndpoint = await withFallback(
    REVIEW_READ_METHOD,
    async () => await callGet(REVIEW_READ_METHOD, { venue_name: venueId }),
    async () => null,
  ).catch(() => null)
  if (carriesReview(fromEndpoint)) return normalise(fromEndpoint, 'endpoint')

  // 2. The record in hand. No round trip, and it is what ships today.
  if (carriesReview(venue)) return normalise(venue, 'venue')

  // 3. The dashboard row — `get_vendor_dashboard` is confirmed to carry the
  //    review fields; `get_venue_detail` is not, and the screen reads detail.
  try {
    const dash = await call('shotright.api.get_vendor_dashboard')
    const row = (dash?.venues || []).find(
      (v) => v?.name === venueId || v?.venue_name === venueId,
    )
    if (carriesReview(row)) return normalise(row, 'dashboard')
  } catch {
    // A failed dashboard read must not take down a screen that already has the
    // venue, the derived gaps and the way to reach a human.
  }

  return normalise(null, 'none')
}

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

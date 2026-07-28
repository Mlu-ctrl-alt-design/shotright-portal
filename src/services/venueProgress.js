import { callGet, USE_MOCKS } from './api'
import { mockBackend } from './mockBackend'
import { withFallback } from './vendor'

/**
 * What a partner sees while their venue is being reviewed.
 *
 * THE HARD PART OF THIS SCREEN IS NOT THE LAYOUT, IT IS THE VOCABULARY.
 *
 * The designs show each part of a listing carrying its own verdict — *Venue
 * details: Approved*, *Menu photos & prices: In review*. That is a statement
 * about what a moderator has decided, and **the bench has no such thing**: the
 * workflow has three states on the whole `Venue` and nothing underneath it.
 *
 * So we can build most of that screen, but not with those words. What we can
 * see for ourselves is whether each part of the listing is FILLED IN. What we
 * cannot see is whether a human has looked at it and been satisfied. Those are
 * different claims, they look nearly identical in a table of green badges, and
 * printing the second when we only know the first would be the same mistake as
 * the decline screen inventing a reason — with the extra harm that a partner
 * reading "Approved" next to four sections will conclude they are nearly live.
 *
 * The split, in one line each:
 *
 *   `deriveSections()`  — what YOU have given us. Ours to compute, true today.
 *   `getReviewSections()` — what WE have signed off. The bench's to answer, and
 *                           it cannot yet, so the screen says so rather than
 *                           borrowing the first set of words for the second.
 *
 * The moment a per-section endpoint exists, `getReviewSections` starts
 * returning and the screen upgrades itself — real verdicts replace our
 * observations and the disclaimer comes off. No release needed.
 */

/**
 * Names the per-section endpoint might land under.
 *
 * A list rather than a string, because a single guessed method name has now
 * cost this project six bugs — most recently `get_venue_review`, which turned
 * out to be `get_review_fix_items`. Nobody has to be right about the name.
 */
export const REVIEW_SECTION_METHODS = [
  'shotright.api.get_venue_review_sections',
  'shotright.api.get_review_sections',
  'shotright.api.get_venue_progress',
]

const text = (value) => String(value ?? '').replace(/<[^>]*>/g, '').trim()

/**
 * When did this venue go in?
 *
 * `submitted_on` is what we've asked for (§15) and is the only field that means
 * what this screen needs it to mean. Until it exists we fall back to `creation`
 * — but ONLY as "Added", never as "Submitted", and never as the basis for an
 * elapsed-time claim.
 *
 * The difference matters on a resubmit: `creation` is when the record was first
 * made, so a venue declined in June, fixed and resubmitted today would report
 * "waiting 8 weeks" if we counted from it. `modified` is worse still — it moves
 * whenever anyone touches the row. A date we can label honestly beats a
 * duration we'd be guessing at.
 */
export function submittedAt(venue) {
  if (venue?.submitted_on) return { date: venue.submitted_on, exact: true }
  if (venue?.creation) return { date: venue.creation, exact: false }
  return null
}

/**
 * What's in the listing, section by section.
 *
 * `state` is one of:
 *   'done'    — there is something there
 *   'partial' — some of it, and the gap is worth naming
 *   'missing' — nothing, and it will hold the listing back
 *
 * NOT 'approved'. Never 'approved'. See the file header.
 *
 * Ordered the way the wizard collects them, so this reads as a progress trail
 * of a journey the partner remembers taking, rather than an arbitrary audit.
 */
export function deriveSections(venue, { photos = [], menu = [] } = {}) {
  const sections = []

  /* --- venue details ---------------------------------------------------- */
  const hasName = Boolean(text(venue?.venue_name))
  const hasAddress = Boolean(text(venue?.address))
  const hasPin = Number.isFinite(venue?.latitude) && Number.isFinite(venue?.longitude)
  const hasDescription = Boolean(text(venue?.atmosphere_desc) || text(venue?.summary))

  sections.push({
    key: 'details',
    label: 'Venue details',
    to: 'edit',
    ...(hasName && hasAddress && hasPin
      ? hasDescription
        ? { state: 'done', detail: 'Name, address, location and description.' }
        : {
            state: 'partial',
            detail: 'No description yet — a line or two about what a night here is like.',
          }
      : !hasPin && hasAddress
        ? {
            state: 'partial',
            detail:
              'No location pin. Customers search by what’s near them, so a venue without one is never found.',
          }
        : { state: 'missing', detail: 'The address and map pin are what make you findable.' }),
  })

  /* --- operating hours -------------------------------------------------- */
  const hours = Array.isArray(venue?.operating_hours) ? venue.operating_hours : []
  const openDays = hours.filter((row) => !row?.closed && (row?.open_time || row?.opens))
  sections.push({
    key: 'hours',
    label: 'Operating hours',
    to: 'edit',
    ...(openDays.length
      ? {
          state: 'done',
          detail: `Open ${openDays.length} day${openDays.length === 1 ? '' : 's'} a week.`,
        }
      : {
          state: 'missing',
          detail: 'Without hours we can’t tell anyone whether you’re open tonight.',
        }),
  })

  /* --- moods ------------------------------------------------------------ */
  const moods = venue?.moods || []
  sections.push({
    key: 'moods',
    label: 'Moods & vibe',
    to: 'edit',
    ...(moods.length
      ? { state: 'done', detail: `${moods.length} mood${moods.length === 1 ? '' : 's'} chosen.` }
      : {
          state: 'missing',
          detail: 'Sho’t Right matches people by mood. A venue with none can’t be matched at all.',
        }),
  })

  /* --- photos ----------------------------------------------------------- */
  sections.push({
    key: 'photos',
    label: 'Photos of the venue',
    to: 'edit',
    ...(photos.length
      ? {
          state: 'done',
          detail: `${photos.length} photo${photos.length === 1 ? '' : 's'}.`,
        }
      : {
          state: 'missing',
          detail: 'A listing with no picture asks someone to choose their evening on a name alone.',
        }),
  })

  /* --- menu ------------------------------------------------------------- */
  const items = menu.flatMap((heading) => heading?.items || [])
  const unpriced = items.filter((item) => !(Number(item?.price) > 0))
  sections.push({
    key: 'menu',
    label: 'Menu & prices',
    to: 'menu',
    ...(items.length === 0
      ? {
          state: 'missing',
          detail: 'Even a handful of items gives someone a reason to choose you.',
        }
      : unpriced.length
        ? {
            state: 'partial',
            detail: `${unpriced.length} of ${items.length} item${
              items.length === 1 ? '' : 's'
            } ${unpriced.length === 1 ? 'has' : 'have'} no price.`,
          }
        : { state: 'done', detail: `${items.length} items, all priced.` }),
  })

  return sections
}

/**
 * The reviewer's own per-section verdicts, if the bench can answer.
 *
 * Returns `{available: false, sections: []}` until a method exists. The screen
 * checks `available` before it uses the word "approved" anywhere — that check
 * is the whole point of this function existing separately from the one above.
 */
export const getReviewSections = async (venueId) => {
  if (USE_MOCKS) {
    const sections = await mockBackend.getReviewSections?.(venueId)
    return { available: Boolean(sections), sections: sections || [] }
  }

  for (const method of REVIEW_SECTION_METHODS) {
    try {
      const payload = await withFallback(
        method,
        async () => await callGet(method, { venue_name: venueId }),
        async () => undefined,
      )
      if (payload === undefined) continue

      const rows = Array.isArray(payload) ? payload : payload?.sections || []
      if (!rows.length) continue

      return {
        available: true,
        method,
        sections: rows.map((row, index) => ({
          key: row.name || row.section || `section-${index}`,
          label: row.label || row.section || 'Section',
          // The bench's word, passed through unchanged. If it says something we
          // don't recognise, showing it beats mapping it onto one of ours.
          state: row.state || row.status || '',
          detail: row.notes || row.detail || '',
          blockedOn: row.blocked_on || row.waiting_on || '',
        })),
      }
    } catch {
      // Deployed and raising. Not a capability answer — fall through to our own
      // observations rather than putting an exception on a waiting partner's
      // screen.
      break
    }
  }

  return { available: false, sections: [] }
}

/** Counts for the "N of M" line. Only ever about what's filled in. */
export const sectionTally = (sections) => ({
  done: sections.filter((s) => s.state === 'done').length,
  total: sections.length,
})

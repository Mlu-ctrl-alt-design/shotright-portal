/**
 * Venue approval states, and why this file exists.
 *
 * THE BUG: a venue was declined in the Desk and the portal's Declined tab
 * stayed empty.
 *
 * The portal filtered on `workflow_state === 'Rejected'` — an exact string I
 * invented in `backend/api_reference.py` before the real backend existed, in
 * three separate places. The bench uses its own vocabulary. One word out and
 * the venue is filtered into nothing: it does not appear under Declined, the
 * count reads zero, and there is no error anywhere, because from the code's
 * point of view nothing went wrong.
 *
 * THE FIX IS NOT A BETTER GUESS. It is to stop matching on one literal:
 *
 *  1. States are matched against a SET of aliases per bucket, ignoring case,
 *     punctuation and spacing. "Rejected", "Declined", "declined" and
 *     "Not Approved" all land in the same place.
 *  2. An unrecognised state is never silently dropped. `bucketOf` returns null,
 *     the venue still appears under All with its raw status shown, and the UI
 *     says so on an empty tab rather than implying there is nothing there.
 *
 * (2) is what makes this robust to the next word nobody anticipated. If the
 * bench introduces "On Hold" tomorrow, a partner sees "1 venue has a status
 * this portal doesn't recognise yet" instead of a venue that has vanished.
 *
 * ✅ CONFIRMED 28 Jul. The bench workflow is **Venue Approval** (`is_active=1`)
 * and its states are exactly **Pending / Approved / Declined**. All three are
 * already in the lists below, so the buckets match the live vocabulary — this
 * is no longer a guess wrapped in a safety net.
 *
 * ✅ UPDATED 23 Aug. The workflow gained **Draft** as its first state (the
 * submission gate). Draft has its own bucket: it is the one state that means
 * "waiting on the partner", and every other bucket means the opposite.
 *
 * The aliases stay regardless. They cost nothing, and what they prevent is the
 * silent failure: the day a fourth state appears, an unrecognised venue is
 * shown with its raw status instead of vanishing.
 */

/** Lowercase, strip punctuation, collapse whitespace. The comparison key. */
const normalise = (state) =>
  String(state || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Aliases per bucket.
 *
 * Generous on purpose: a false positive here shows a venue under a slightly
 * wrong tab, which a partner can see and query. A false negative hides it
 * completely, which nobody can see. Those costs are not symmetric.
 */
const ALIASES = {
  approved: ['approved', 'active', 'live', 'published', 'accepted', 'open'],
  pending: [
    'pending',
    'pending review',
    'pending approval',
    'awaiting approval',
    'awaiting review',
    'in review',
    'under review',
    'submitted',
  ],
  declined: ['declined', 'rejected', 'denied', 'refused', 'not approved', 'cancelled', 'canceled'],
  /**
   * ⚠️ 23 Aug: 'draft' and 'new' MOVED OUT of pending. Draft became a real
   * bench state that day (the submission gate: create_venue lands in Draft,
   * and only submit_venue_for_review queues it). Bucketing draft under
   * pending was harmless while no venue could actually hold the state; now
   * it would tell a partner "you're waiting on us" about a listing that is
   * in no queue at all and waiting on THEM.
   */
  draft: ['draft', 'new', 'unsubmitted', 'not submitted'],
}

const LOOKUP = new Map(
  Object.entries(ALIASES).flatMap(([bucket, words]) => words.map((w) => [w, bucket])),
)

/** 'approved' | 'pending' | 'declined' | null for anything unrecognised. */
export function bucketOf(state) {
  return LOOKUP.get(normalise(state)) ?? null
}

/**
 * What the partner is shown.
 *
 * The designs say "Declined" where the workflow may say "Rejected"; partners
 * should see one word for one state, or a Declined tab listing rows badged
 * "Rejected" invites the reasonable question of whether they differ.
 *
 * An unrecognised state passes through UNCHANGED rather than being replaced
 * with "Unknown". Showing the bench's actual word is what lets someone
 * recognise the mismatch and fix this file.
 */
const BUCKET_LABELS = { approved: 'Approved', pending: 'Pending', declined: 'Declined', draft: 'Draft' }

export function stateLabel(state) {
  const bucket = bucketOf(state)
  return bucket ? BUCKET_LABELS[bucket] : state || '—'
}

/** Badge palette key. Unrecognised states get the neutral one. */
const BUCKET_TONES = { approved: 'Approved', pending: 'Pending', declined: 'Rejected', draft: 'Draft' }

export const stateTone = (state) => BUCKET_TONES[bucketOf(state)] ?? 'Draft'

export const inBucket = (venue, bucket) => bucketOf(venue?.workflow_state) === bucket

/**
 * States present in this list that no bucket claims.
 *
 * Drives the "we don't recognise this status" note. Returned as distinct raw
 * strings so the message can name them — "we don't recognise something" is not
 * actionable; "we don't recognise 'On Hold'" is.
 */
export function unrecognisedStates(venues) {
  return [
    ...new Set(
      (venues || [])
        .map((v) => v?.workflow_state)
        .filter((s) => s && !bucketOf(s)),
    ),
  ]
}

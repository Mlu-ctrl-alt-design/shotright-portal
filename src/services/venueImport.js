import { saveDraft, draftsArePortable } from './setupDraft'

/**
 * Turn spreadsheet rows into venue DRAFTS, not venues.
 *
 * ⚠️ THIS USED TO CALL `create_venue` AND IT WAS THE WRONG SHAPE. A venue made
 * from a spreadsheet has no photographs, and a listing with no picture asks
 * someone to choose where to spend their evening on the strength of a name — so
 * eleven of them went into the review queue as eleven things a reviewer had to
 * send back. The partner's own words for the fix: get them onto the platform in
 * draft, then add the images.
 *
 * A draft is exactly that, and it already exists: it is what the wizard writes
 * every few seconds, and every row lands in the same place the wizard would
 * have put it. So a partner opens one, finds nine fields already filled in from
 * their own file, adds photographs, and submits — through the flow that already
 * requires a photo rather than around it.
 *
 * NOTHING IS SUBMITTED. No venue exists, no reviewer sees anything, and a bad
 * row costs a deleted draft rather than a listing that cannot be deleted at all.
 * That is the whole reason this reads better than the version it replaces.
 */

/**
 * The wizard's own initial state, mirrored.
 *
 * ⚠️ These MUST stay in step with `VenueWizard`'s `INITIAL_DETAILS` and
 * `INITIAL_HOURS`. A draft is resumed by spreading `saved.details` over those
 * defaults, so a key that only exists here is one the wizard will not show and
 * a key missing here simply falls back — which is the safe direction, and the
 * reason this is a partial rather than a copy of the whole shape.
 */
const draftPayload = (venue) => ({
  moods: { moods: venue.moods },
  details: {
    venue_name: venue.venue_name,
    address: venue.address,
    latitude: venue.latitude ?? undefined,
    longitude: venue.longitude ?? undefined,
    dress_code: venue.dress_code,
  },
  hours: {
    weekday: venue.operating_hours.weekday,
    weekend: venue.operating_hours.weekend,
  },
  photos: [],
  /* Straight to the form. A row that arrived in a spreadsheet has already been
     "imported" — offering the import screen again would invite the partner to
     overwrite the values they just uploaded. */
  stage: 'form',
})

/**
 * Which sections the spreadsheet actually answered.
 *
 * `basics` is deliberately absent even though the sheet carries a venue name:
 * it also wants a manager and a contact number, and neither is a column. A
 * section marked complete that nobody has looked at is how a partner submits a
 * venue believing they have seen it — so they land on `basics`, which is also
 * the first thing on the page.
 *
 * ⚠️ These are the SECTION keys from `wizardSteps.js`, not the old step keys.
 * They changed on 17 Sep when the wizard became one page; a draft written with
 * the old ones still opens, because `stepIndex` maps the retired names.
 */
const COMPLETED_BY_SHEET = ['vibe', 'hours']
const LANDS_ON = 'basics'

export async function importVenueDrafts(rows, { onProgress, signal } = {}) {
  const created = []
  const failed = []

  for (let i = 0; i < rows.length; i += 1) {
    if (signal?.aborted) break
    const row = rows[i]
    onProgress?.({ done: i, total: rows.length, current: row.venue.venue_name })

    try {
      // eslint-disable-next-line no-await-in-loop
      const draft = await saveDraft({
        step: LANDS_ON,
        completed: COMPLETED_BY_SHEET,
        venue_name: row.venue.venue_name,
        payload: draftPayload(row.venue),
      })
      created.push({
        lineNumber: row.lineNumber,
        name: row.venue.venue_name,
        id: draft?.id || null,
        notes: row.notes,
      })
    } catch (err) {
      /* One failure does not end the run. Stopping at the first leaves a
         partner with four of eleven, no record of which four, and a file they
         dare not upload again. Nothing is retried either — a save that failed
         may still have written, and a second attempt is how one venue becomes
         two drafts. */
      failed.push({
        lineNumber: row.lineNumber,
        name: row.venue.venue_name,
        reason: err?.message || 'The server refused it and did not say why.',
      })
    }
  }

  onProgress?.({ done: rows.length, total: rows.length, current: null })

  /**
   * ⚠️ WHETHER THESE ARE ACTUALLY ON THE PLATFORM.
   *
   * `saveDraft` falls back to this browser's localStorage when the bench has no
   * draft endpoint. That is right for one draft — better than losing the
   * wizard — and it is a different promise for eleven: they are on this laptop,
   * not on the account, and they are gone with the browser's site data. A
   * partner told "your venues are in drafts" who then opens their phone and
   * finds nothing has been failed by us, not by their browser.
   */
  return { created, failed, portable: draftsArePortable() }
}

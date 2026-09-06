import { createVenue } from './vendor'

/**
 * Create the venues a spreadsheet described, one at a time.
 *
 * ⚠️ ONE AT A TIME, IN ORDER, AND IT DOES NOT STOP. Sequential rather than
 * `Promise.all` for two reasons that both matter more than the seconds saved:
 * the bench is a single site behind a proxy and forty simultaneous writes is a
 * good way to be rate-limited into a partial import nobody can explain, and a
 * partner watching "6 of 11" wants those to be the first six of their own list,
 * not six arbitrary ones.
 *
 * A row that fails does NOT end the run. The alternative — stopping at the
 * first bad venue — leaves a partner with four of eleven created, no record of
 * which four, and a file they dare not upload again.
 *
 * NOTHING IS RETRIED. A create that failed may still have written; a second
 * attempt would be how one venue becomes two listings splitting one venue's
 * bookings. The row is reported and left for a person to decide about.
 */
export async function importVenues(rows, { onProgress, signal } = {}) {
  const created = []
  const failed = []

  for (let i = 0; i < rows.length; i += 1) {
    if (signal?.aborted) break
    const row = rows[i]
    onProgress?.({ done: i, total: rows.length, current: row.venue.venue_name })

    try {
      // eslint-disable-next-line no-await-in-loop
      const { venue, warnings } = await createVenue(row.venue)
      created.push({
        lineNumber: row.lineNumber,
        name: row.venue.venue_name,
        id: venue?.name || venue?.venue_name || null,
        /* `createVenue`'s own warnings ride along — "no map location", "these
           moods are with the team for review". They are true of a bulk import
           exactly as they are of one venue, and swallowing them here would make
           the same venue quieter for having arrived in a spreadsheet. */
        warnings: warnings || [],
      })
    } catch (err) {
      failed.push({
        lineNumber: row.lineNumber,
        name: row.venue.venue_name,
        reason: err?.message || 'The server refused it and did not say why.',
      })
    }
  }

  onProgress?.({ done: rows.length, total: rows.length, current: null })
  return { created, failed }
}

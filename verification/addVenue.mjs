/**
 * Getting a Playwright page onto the add-venue FORM.
 *
 * ⚠️ ADDED 17 Sep, when the five-step wizard became import → page → photos.
 * Every suite that drives this flow used to open `/venues/new`, type a mood and
 * press Next. There is no mood step and no Next any more, and four suites were
 * each doing their own version of that walk — so the walk lives here now and a
 * flow change costs one edit rather than four.
 *
 * SCREEN ONE IS CONDITIONAL. The import screen only renders when the bench can
 * serve a route, and most of these suites stub a bench that cannot, so it is
 * usually not there at all. `skip` handles both worlds rather than making every
 * caller know which one it is in.
 */

/** Dismiss the import screen if this bench offered one. */
export async function skipImport(page) {
  const skip = page.getByRole('button', { name: /skip — i.ll type it in myself/i })
  try {
    await skip.waitFor({ timeout: 2500 })
    await skip.click()
  } catch {
    /* No import screen on this bench — which is the live bench's behaviour and
       is not a failure. The form is already what is on screen. */
  }
}

/** Open the add-venue flow and land on the form, whichever way it starts. */
export async function toVenueForm(page, BASE) {
  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  await skipImport(page)
  await page.getByRole('textbox', { name: 'Venue name', exact: true }).waitFor({ timeout: 15000 })
}

/**
 * Pick a mood chip.
 *
 * Moods are the canonical list rendered as chips now, not a text field — the
 * redesign turned recall into recognition. A mood the bench does not have
 * cannot be typed in here at all, which is the point; use the "Nothing fits?"
 * disclosure for that.
 */
export async function pickMood(page, label = 'Chilled Bar') {
  await page.getByRole('button', { name: label, exact: true }).click()
}

/**
 * Answer one guided prompt.
 *
 * ⚠️ NOT OPTIONAL, though it looks it. `submit_venue_for_review` refuses a
 * venue with an empty description, so a walk that skips this reaches Declined
 * rather than Pending.
 */
export async function describeVenue(page, text = 'slow-cooked lamb and a proper fire') {
  await page.getByLabel(/known for\?/i).fill(text)
}

/** Open the collapsed location panel, so the address field is reachable. */
export async function openLocation(page) {
  /* Idempotent. Once the panel is open the toggle reads "Done", so a second
     call must not go looking for "Add address" and time out — several suites
     open it to look at the map and then walk the form normally. */
  const address = page.getByRole('combobox', { name: 'Address', exact: true })
  if (await address.isVisible().catch(() => false)) return

  await page.getByRole('button', { name: /add address|check it/i }).click()
  await page.getByRole('combobox', { name: 'Address', exact: true }).waitFor({ timeout: 10000 })
  /* The map is lazy-loaded, so the address field arriving does not mean the
     map has. Waiting for the map's own node rather than a timeout, because a
     fixed sleep here is a bet on how busy the machine is. */
  await page.locator('[data-field="latitude"]').waitFor({ timeout: 15000 })
}

/** Leave the form for the photo screen. */
export async function saveAndAddPhotos(page) {
  const btn = page.getByRole('button', { name: /save and add photos/i })
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
}

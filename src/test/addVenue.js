import { expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

/**
 * Driving the add-venue flow, the way a partner does.
 *
 * ⚠️ REWRITTEN 17 Sep, when the five-step wizard became import → page → photos.
 * The old helpers walked `Next` four times; there is no Next any more. What
 * these do instead is fill the one page, section by section, in the order the
 * sections appear on it.
 *
 * Shared across the suites rather than copied into each, because the previous
 * arrangement had four private `walkToReview` helpers that drifted apart — and
 * a flow change then broke them one file at a time, in four different ways.
 *
 * Queries are by ROLE throughout. These inputs carry a visible <label> AND an
 * aria-label with the same words, so a text lookup matches the same field twice
 * and RTL treats that as an error.
 */

export const NAME = 'Nomsa’s Shisanyama'

/**
 * Screen one, dismissed.
 *
 * It only renders when the bench can serve an import route, and the default
 * fake bench deploys `search_places`, so most walks start here. A test on a
 * bench with no Places proxy skips straight to the form and this is a no-op —
 * which is exactly the behaviour worth having in the helper rather than in
 * every caller.
 */
export async function skipImport(user) {
  const skip = await screen
    .findByRole('button', { name: /skip — i’ll type it in myself/i }, { timeout: 4000 })
    .catch(() => null)
  if (skip) await user.click(skip)
  await screen.findByRole('textbox', { name: /venue name/i }, { timeout: 4000 })
}

/** The basics: who you are and how a customer reaches you. */
export async function fillBasics(user, { name = NAME } = {}) {
  await user.clear(await screen.findByRole('textbox', { name: /venue name/i }))
  await user.type(screen.getByRole('textbox', { name: /venue name/i }), name)

  const manager = screen.getByRole('textbox', { name: /^manager$/i })
  await user.clear(manager)
  await user.type(manager, 'Nomsa Dlamini')

  const phone = screen.getByRole('textbox', { name: /contact number/i })
  await user.clear(phone)
  await user.type(phone, '+27 82 111 2222')
  return name
}

/**
 * Set the location by picking an address suggestion.
 *
 * The map lives behind a confirm row now — auto-pinned from the address and
 * opened only by someone who wants to check it — so this opens the panel first.
 * That IS the partner's path: there is no other way to reach the address field.
 *
 * Waits for the POINT, not for the map's heading. That heading renders with or
 * without a location, so waiting on it waits for nothing; the coordinate is on
 * the map wrapper, which is the only place it is exposed.
 */
export async function setLocation(user) {
  await user.click(screen.getByRole('button', { name: /add address|check it|^done$/i }))
  await user.type(await screen.findByRole('combobox', { name: /^address/i }), '4th Ave, Mamelodi')
  await user.click(await screen.findByRole('button', { name: /Gauteng, South Africa/i }))
  await waitFor(() => {
    const node = document.querySelector('[data-field="latitude"]')
    expect(node?.getAttribute('data-latitude')).toBeTruthy()
  })
}

/**
 * Pick a mood.
 *
 * Chips off the canonical list, not a text field — the redesign turned recall
 * into recognition. `Chilled` is on the default fake bench.
 */
export async function pickMood(user, mood = 'Chilled') {
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${mood}$`, 'i') }))
}

/**
 * Answer one guided prompt.
 *
 * ⚠️ NOT OPTIONAL, though it looks it. `submit_venue_for_review` refuses a
 * venue with an empty description, so a walk that skips this reaches Declined
 * rather than Pending — which is precisely the trap the requirement exists to
 * keep partners out of. One answer is enough.
 */
export async function describeVenue(user, text = 'slow-cooked lamb and a proper fire') {
  await user.type(await screen.findByLabelText(/known for\?/i), text)
}

/**
 * Everything the page needs, in page order.
 *
 * `coords: false` deliberately leaves the pin unset — a venue with no point is
 * never returned by a radius search, so being stopped for it is the behaviour
 * several tests are about.
 */
export async function fillPage(
  user,
  { name = NAME, coords = true, mood = true, words = true } = {},
) {
  const filled = await fillBasics(user, { name })
  if (coords) await setLocation(user)
  if (mood) await pickMood(user)
  if (words) await describeVenue(user)
  // Days default to Mon–Fri, so the hours section is already satisfied.
  return filled
}

/** Leave the form for the photo screen. */
export async function saveAndAddPhotos(user) {
  await user.click(screen.getByRole('button', { name: /save and add photos/i }))
}

/**
 * Upload one photo.
 *
 * ⚠️ PHOTOS ARE REQUIRED when the bench accepts uploads, which the fake bench
 * does by default — so the happy path here is the enforced path. The unenforced
 * path has its own tests.
 */
export async function addPhoto(user) {
  const file = new File(['png-bytes'], 'venue.png', { type: 'image/png' })
  await user.upload(
    await screen.findByLabelText(/venue photos — choose files/i),
    file,
  )
  // Wait for the upload to land, not just for the input to accept the file:
  // the counter only moves once the server has answered.
  await waitFor(() => expect(screen.getByText(/1 of 10/i)).toBeInTheDocument())
}

export const sendForReview = async (user) =>
  user.click(await screen.findByRole('button', { name: /send for review/i }))

/**
 * Skip the import, fill the page, save, add a photo — everything up to the
 * final button. Leaves the partner on the photo screen with Send for review.
 */
export async function walkToReview(user, opts = {}) {
  await skipImport(user)
  const name = await fillPage(user, opts)
  await saveAndAddPhotos(user)
  if (opts.photo !== false) await addPhoto(user)
  return name
}

/** The whole thing, submitted. */
export async function completeVenue(user, opts = {}) {
  const name = await walkToReview(user, opts)
  await sendForReview(user)
  return name
}

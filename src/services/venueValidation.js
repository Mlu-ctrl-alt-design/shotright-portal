/**
 * Validation rules for the add-venue page.
 *
 * THE PROBLEM THIS FIXES: nothing was validated until SUBMIT, on the last of
 * five steps. A partner could fill four screens, press Submit, and be told
 * "Your venue needs a name — add one on 'Your venue's details'" — a message
 * naming a screen they left three steps ago, with no way to see which field it
 * meant until they had navigated back and found it themselves.
 *
 * Validation now happens where the work happens: per field as it is filled, per
 * SECTION for the progress rail, and at save — where it is a safety net that
 * should never fire rather than the first line of defence.
 *
 * ⚠️ RESHAPED 17 Sep, when the five-step wizard became one scrolling page. The
 * rules themselves barely moved; what changed is that they are grouped by the
 * SECTIONS the rail counts rather than by the five screens that are gone.
 * The rail is the honest count of "how much is left", so the thing it counts
 * has to be the same thing that stops a save — two different definitions of
 * done is how a form gets a full progress bar and a blocked button.
 *
 * ---------------------------------------------------------- WHAT IS REQUIRED
 *
 * Kept deliberately short. Every required field is one where leaving it empty
 * produces a venue that is broken rather than merely sparse. Requiring anything
 * else trades a real cost — partners abandoning a form that will not let them
 * past — for tidier records.
 *
 *   venue_name      `create_venue` rejects a venue without one. Hard failure.
 *   manager         who we call when something is wrong with a live listing.
 *                   ⚠️ Product judgement, asked for on 16 Sep — not a backend
 *                   constraint. The API would take a venue with no manager.
 *   contact_number  the number a customer rings to book. A venue nobody can
 *                   phone is a listing that generates complaints, not covers.
 *   moods           the product finds venues BY MOOD. A venue with none cannot
 *                   be found by anybody, so it is not a listing, it is a row in
 *                   a table. ⚠️ Also a product judgement.
 *   coordinates     `find_venues` is a radius search. Without a point the venue
 *                   saves, looks completely fine, and never appears.
 *   open days       hours with no open day describe a venue that is never open.
 *   a description   ⚠️ NOT our rule. `submit_venue_for_review` refuses a venue
 *                   with an empty description outright. See `validateWords`.
 *   photos          a venue with no picture is a name and an address. The app
 *                   is a MOOD product — people choose where to go by looking.
 *                   ⚠️ CONDITIONAL, and the condition is not a hedge: it is
 *                   only required when the uploader actually works, and it is
 *                   now enforced on the PHOTOS SCREEN rather than here, because
 *                   that is where the photos are. See `validatePhotos`.
 *
 * Everything else — address text, dress code — is optional and validated only
 * for FORMAT when present. A partner who has not decided on a dress code
 * should still be able to list.
 */

/* ------------------------------------------------------------------ format */

/**
 * Loose on purpose. The job is to catch a typo, not to adjudicate what a valid
 * South African number is — a partner with a landline, a shortcode, or an
 * international number must not be locked out by a regex written in an
 * afternoon. Anything with 9 to 15 digits passes.
 */
export function validatePhone(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 15) {
    return 'That does not look like a phone number.'
  }
  return null
}

const inRange = (n, min, max) => Number.isFinite(n) && n >= min && n <= max
const filled = (value) => Boolean(String(value || '').trim())

/* ---------------------------------------------------------------- sections */

/** Who you are. Name, manager, a number customers can ring. */
export function validateBasics(state) {
  const errors = {}

  if (!filled(state?.venue_name)) errors.venue_name = 'Your venue needs a name.'
  if (!filled(state?.manager)) errors.manager = 'Who manages this venue?'

  if (!filled(state?.contact_number)) {
    errors.contact_number = 'Customers need a number to call.'
  } else {
    const problem = validatePhone(state.contact_number)
    if (problem) errors.contact_number = problem
  }

  return errors
}

/** Where you are. One requirement across two numbers. */
export function validateWhere(state) {
  const errors = {}
  const hasLat = Number.isFinite(state?.latitude)
  const hasLng = Number.isFinite(state?.longitude)

  if (!hasLat || !hasLng) {
    // ONE LINE at the narrowest column this renders in — see the reserved
    // message row in `Input`. The consequence ("customers will not find you")
    // is carried by the map's own warning, which has room for it.
    const message = 'Set your location — pick an address or drop the pin.'
    if (!hasLat) errors.latitude = message
    if (!hasLng) errors.longitude = message
    return errors
  }

  if (!inRange(state.latitude, -90, 90)) errors.latitude = 'Latitude must be between -90 and 90.'
  if (!inRange(state.longitude, -180, 180)) {
    errors.longitude = 'Longitude must be between -180 and 180.'
  }
  return errors
}

/** The vibe. At least one mood, or nobody finds this venue. */
export function validateVibe(state) {
  const errors = {}
  if (!state?.moods?.length) {
    errors.moods =
      'Pick at least one. Customers search Sho’t Right by vibe, so a venue with no moods will not appear in any search.'
  }
  return errors
}

/** When you are open. */
export function validateHours(state) {
  const errors = {}

  if (!state?.days?.length) errors.days = 'Pick at least one day you are open.'

  for (const [key, label] of [
    ['weekday', 'Closing time'],
    ['weekend', 'Weekend closing time'],
    ['publicHoliday', 'Public holiday closing time'],
  ]) {
    const range = state?.[key]
    if (!range?.start || !range?.end) continue
    // Equal times are rejected too: "09:00 to 09:00" is not a venue that is
    // open for zero minutes, it is a partner who has not finished typing.
    if (range.start >= range.end) errors[key] = `${label} must be after the opening time.`
  }

  return errors
}

/**
 * A description, in the partner's own words.
 *
 * ⚠️ REQUIRED, and by the backend rather than by us. `submit_venue_for_review`
 * treats an empty description as a BLOCKER and refuses the listing to Declined
 * with "Describe the venue." — see `venue_completeness.py`. The old wizard met
 * that requirement by accident, through an atmosphere dropdown that
 * `create_venue` maps onto `atmosphere_desc`; the redesign replaced that
 * dropdown with mood chips, so the guided answers are now the only thing
 * feeding it.
 *
 * ANY ONE of the three answers satisfies this. That is the whole point of
 * asking three short questions instead of presenting a blank box: nobody has to
 * write a paragraph, they have to answer one question in four words.
 */
export function validateWords(state) {
  const errors = {}
  const answered = ['known', 'night', 'who'].some((key) => filled(state?.[key]))
  if (!answered) {
    errors.words =
      'Answer one of these. Reviewers send back venues with nothing written about them, and it is the first thing a customer reads.'
  }
  return errors
}

/**
 * AT LEAST ONE PHOTO — but only when a photo can actually be uploaded.
 *
 * `photosRequired` comes from the photo capability probe and is false when the
 * bench refuses uploads. That is not softening the rule, it is the same rule
 * the legal gate follows: **never enforce what nobody can satisfy.**
 *
 * The reason is concrete rather than theoretical. On 8 Aug two partners
 * reported that `upload_file` returns 403 — venue photos AND the menu importer,
 * one cause. If this were unconditional while that is true, the flow would
 * refuse to submit, the partner would have no way to make it submit, and NOBODY
 * COULD LIST A VENUE AT ALL. A rule that turns a "some venues look sparse"
 * problem into a "nobody can onboard" problem is not stricter, it is an outage.
 */
export function validatePhotos(state) {
  const errors = {}
  if (state?.photosRequired && !(state?.photos?.length > 0)) {
    errors.photos =
      'Add at least one photo. People choose where to go by looking, so a venue with no pictures rarely gets picked.'
  }
  return errors
}

const VALIDATORS = {
  basics: validateBasics,
  where: validateWhere,
  vibe: validateVibe,
  hours: validateHours,
  words: validateWords,
  photos: validatePhotos,
}

/**
 * Errors for one section, given the slice of state it describes.
 *
 * `touched` limits which fields report, so a partner arriving on the page does
 * not immediately see every empty field in red — that is an accusation, not
 * help. The save gate passes nothing, which reveals everything outstanding.
 */
export function validateSection(key, state, touched = null) {
  const validator = VALIDATORS[key]
  if (!validator) return {}
  const errors = validator(state)
  return touched ? pickTouched(errors, touched) : errors
}

/** Is this section finished? What the progress rail ticks. */
export const sectionDone = (key, state) => Object.keys(validateSection(key, state)).length === 0

function pickTouched(errors, touched) {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => touched.has(key)))
}

/**
 * Which section a field lives in, so a problem found at save can scroll to it
 * rather than describing where to go.
 */
export const FIELD_SECTION = {
  venue_name: 'basics',
  manager: 'basics',
  contact_number: 'basics',
  latitude: 'where',
  longitude: 'where',
  moods: 'vibe',
  days: 'hours',
  weekday: 'hours',
  weekend: 'hours',
  publicHoliday: 'hours',
  words: 'words',
  photos: 'photos',
}

/**
 * The DOM order fields appear in, so "focus the first invalid field" means the
 * first one on SCREEN rather than the first key JavaScript happens to iterate.
 * Getting this wrong scrolls people to the bottom of the page to fix something
 * that was at the top.
 */
export const FIELD_ORDER = [
  'venue_name',
  'manager',
  'contact_number',
  'latitude',
  'longitude',
  'moods',
  'days',
  'weekday',
  'weekend',
  'publicHoliday',
  'words',
  'photos',
]

export const firstInvalid = (errors) =>
  FIELD_ORDER.find((field) => errors[field]) || Object.keys(errors)[0]

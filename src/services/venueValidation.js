/**
 * Validation rules for the venue wizard.
 *
 * THE PROBLEM THIS FIXES: nothing was validated until SUBMIT, on the last of
 * five steps. A partner could fill four screens, press Submit, and be told
 * "Your venue needs a name — add one on 'Your venue's details'" — a message
 * naming a screen they left three steps ago, with no way to see which field it
 * meant until they had navigated back and found it themselves.
 *
 * Validation now happens where the work happens: per field as it is filled, per
 * step before it can be left, and only then at submit — where it is a safety
 * net that should never fire rather than the first line of defence.
 *
 * ---------------------------------------------------------- WHAT IS REQUIRED
 *
 * Kept deliberately short. Every required field is a field where leaving it
 * empty produces a venue that is broken rather than merely sparse, and each is
 * justified below. Requiring anything else would trade a real cost — partners
 * abandoning a form that will not let them past — for tidier records.
 *
 *   venue_name      `create_venue` rejects a venue without one. Hard failure.
 *   moods           the product finds venues BY MOOD. A venue with none cannot
 *                   be found by anybody, so it is not a listing, it is a row in
 *                   a table. ⚠️ This one is a product judgement, not a backend
 *                   constraint — the API would accept an empty list.
 *   coordinates     `find_venues` is a radius search. Without a point the venue
 *                   saves, looks completely fine, and never appears. This was
 *                   previously a warning on the success screen, which is the
 *                   worst place to learn it.
 *   open days       hours with no open day describe a venue that is never open.
 *   photos          a venue with no picture is a name and an address. The app
 *                   is a MOOD product — people choose where to go by looking —
 *                   so a listing with nothing to look at competes badly and
 *                   makes the whole grid look unfinished. ⚠️ CONDITIONAL, and
 *                   the condition is not a hedge: it is only required when the
 *                   uploader actually works. See `photosRequired` below.
 *
 * Everything else — manager details, address text, dress code, atmosphere,
 * description, menu — is optional, and validated only for FORMAT when present.
 * A partner who does not know their dress code yet should still be able to list.
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

/* ------------------------------------------------------------------- steps */

/** Step 1 — moods. */
export function validateMoods(state) {
  const errors = {}
  if (!state?.moods?.length) {
    errors.moods =
      'Add at least one mood. Customers search Sho’t Right by vibe, so a venue with no moods will not appear in any search.'
  }
  return errors
}

/**
 * Step 2 — venue details.
 *
 * `touched` limits which fields report, so validating a step does not paint
 * every empty field red the moment someone arrives on it. The wizard passes the
 * full set when gating Next; the step passes only what has been visited.
 */
export function validateDetails(state, touched = null) {
  const errors = {}

  if (!String(state?.venue_name || '').trim()) {
    errors.venue_name = 'Your venue needs a name.'
  }

  const phone = validatePhone(state?.contact_number)
  if (phone) errors.contact_number = phone

  // Coordinates are one requirement across two inputs, so the message goes on
  // whichever is empty and says the same thing either way — a partner who
  // filled only latitude needs to know the pair is what matters.
  const hasLat = Number.isFinite(state?.latitude)
  const hasLng = Number.isFinite(state?.longitude)
  if (!hasLat || !hasLng) {
    // ONE LINE at the narrowest column this renders in — see the reserved
    // message row in `Input`. The consequence ("customers will not find you")
    // is carried by the gate banner and the map's own warning, both of which
    // have room for it.
    const message = 'Set your location — pick an address or drop the pin.'
    if (!hasLat) errors.latitude = message
    if (!hasLng) errors.longitude = message
  } else {
    if (!inRange(state.latitude, -90, 90)) errors.latitude = 'Latitude must be between -90 and 90.'
    if (!inRange(state.longitude, -180, 180)) {
      errors.longitude = 'Longitude must be between -180 and 180.'
    }
  }

  /**
   * AT LEAST ONE PHOTO — but only when a photo can actually be uploaded.
   *
   * `state.photosRequired` is set by the wizard from the photo capability
   * probe, and it is false when the bench refuses uploads. That is not
   * softening the rule, it is the same rule the legal gate follows: **never
   * enforce what nobody can satisfy.**
   *
   * The reason is concrete rather than theoretical. On 8 Aug two partners
   * reported that `upload_file` returns 403 — venue photos AND the menu
   * importer, one cause. If this requirement were unconditional while that is
   * true, the wizard would refuse to advance, the partner would have no way to
   * make it advance, and NOBODY COULD LIST A VENUE AT ALL. A rule that turns a
   * "some venues look sparse" problem into a "nobody can onboard" problem is
   * not a stricter rule, it is an outage.
   *
   * When uploads work, this is a hard requirement and behaves like any other.
   * See qa/clearance-venue-upload.md for the state of that 403.
   */
  if (state?.photosRequired && !(state?.photos?.length > 0)) {
    errors.photos =
      'Add at least one photo. People choose where to go by looking, so a venue with no pictures rarely gets picked.'
  }

  return touched ? pickTouched(errors, touched) : errors
}

/** Step 3 — operating hours. */
export function validateHours(state) {
  const errors = {}

  if (!state?.days?.length) {
    errors.days = 'Pick at least one day you are open.'
  }

  for (const [key, label] of [
    ['weekday', 'Week day'],
    ['weekend', 'Weekend'],
    ['publicHoliday', 'Public holiday'],
  ]) {
    const range = state?.[key]
    if (!range?.start || !range?.end) continue
    // Equal times are rejected too: "09:00 to 09:00" is not a venue that is
    // open for zero minutes, it is a partner who has not finished typing.
    if (range.start >= range.end) {
      errors[key] = `${label} closing time must be after the opening time.`
    }
  }

  return errors
}

const VALIDATORS = {
  mood: validateMoods,
  details: validateDetails,
  hours: validateHours,
  menu: () => ({}),
  review: () => ({}),
}

/** Errors for one step key, given that step's slice of wizard state. */
export function validateStep(stepKey, state, touched = null) {
  const validator = VALIDATORS[stepKey]
  if (!validator) return {}
  return stepKey === 'details' ? validator(state, touched) : validator(state)
}

function pickTouched(errors, touched) {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => touched.has(key)))
}

/**
 * Which step a field lives on, so a problem found at submit can name the step
 * AND jump to it rather than describing where to go.
 */
export const FIELD_STEP = {
  moods: 'mood',
  venue_name: 'details',
  contact_number: 'details',
  photos: 'details',
  latitude: 'details',
  longitude: 'details',
  days: 'hours',
  weekday: 'hours',
  weekend: 'hours',
  publicHoliday: 'hours',
}

/**
 * The DOM order fields appear in, so "focus the first invalid field" means the
 * first one on SCREEN rather than the first key JavaScript happens to iterate.
 * Getting this wrong scrolls people to the bottom of the form to fix something
 * that was at the top.
 */
export const FIELD_ORDER = [
  'venue_name',
  'manager_name',
  'manager_surname',
  'contact_number',
  'address',
  'dress_code',
  'atmosphere',
  'latitude',
  'longitude',
  // The uploader sits below the map on this step, so a partner sent to fix
  // "no photos" should be scrolled past everything else, not to the top.
  'photos',
]

export const firstInvalid = (errors) =>
  FIELD_ORDER.find((field) => errors[field]) || Object.keys(errors)[0]

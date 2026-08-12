import { call, callGet, USE_MOCKS } from './api'
import { withFallback } from './vendor'

/**
 * "Find your venue" — claiming a place that already exists on Google.
 *
 * A restaurant that has been trading for six years is already on Google, with
 * its address, its hours and its phone number correct. Asking that owner to
 * retype all of it is asking them to prove they are serious, and a good number
 * of them will not: the wizard's own drop-off is between "Add New" and the end
 * of step 2. This turns those five minutes into "search, check, done".
 *
 * ============================================================================
 * FOUR RULES, AND THEY ARE NOT NEGOTIABLE
 * ============================================================================
 *
 * 1. **THE API KEY NEVER REACHES THE BROWSER.** Every call here goes to
 *    `shotright.api.*` and the bench holds the key. Places REST keys can only
 *    be restricted by IP or HTTP referrer, so a key shipped in a JS bundle is a
 *    key anyone can lift and spend against your billing account. This is the
 *    reason there is a proxy at all, and it is why there is no `VITE_GOOGLE_*`
 *    variable anywhere in this repo — one would be quietly wrong.
 *
 * 2. **WE STORE THE `place_id` AND NOTHING ELSE OF GOOGLE'S.** The place id is
 *    explicitly storable indefinitely; ratings, reviews, photos, summaries and
 *    the atmosphere attributes are not, and must be fetched live and discarded.
 *    So this file asks for the identity fields a form needs and refuses to be
 *    the route by which anything else gets into the database.
 *
 *    What lands in `Venue` is what the PARTNER SUBMITTED about their own
 *    business, having read and corrected it. Google is being used as a
 *    keyboard, not as a database — that is the distinction the whole flow rests
 *    on, and it is why every prefilled field is marked, editable and clearable
 *    rather than locked.
 *
 * 3. **RESULTS ARE A LIST, NEVER PINS ON OUR MAP.** Places content shown on a
 *    map has to be shown on a Google map, and this portal draws Leaflet over
 *    OpenStreetMap tiles. Dropping Google search results onto those tiles would
 *    be a policy breach. Once the partner picks one, the coordinate is *their*
 *    venue's location — they confirmed it — and our own pin is ours to draw.
 *
 * 4. **NOTHING HERE IS LOAD-BEARING.** The whole feature is capability-detected
 *    and every field it fills stays editable. A bench without the proxy gets
 *    the wizard exactly as it is today, with no dead search box and no
 *    explanation owed to anybody.
 *
 * ============================================================================
 * WHY THIS IS THE CHEAP USE OF PLACES, NOT THE EXPENSIVE ONE
 * ============================================================================
 *
 * The frightening per-view numbers attach to *customer-facing* venue screens:
 * reviews and photos, re-fetched on every view because they cannot be cached,
 * for every customer, for ever. That is an unbounded recurring cost and it buys
 * content you are not allowed to rank, sort or build on.
 *
 * THIS is the opposite shape. It fires ONCE per venue, ever, triggered by the
 * owner, and it asks for identity fields rather than reviews. A search that
 * returns ids only is free and unlimited; the detail call happens on one pick,
 * not on one render. A portal onboarding its whole first cohort makes fewer
 * calls in a month than one customer browsing for an evening.
 *
 * Which is why this flow can be built now and the customer-facing one is a
 * separate decision with a separate budget. They are not the same feature and
 * should not be approved as one.
 */

export const PLACE_SEARCH_METHODS = [
  'shotright.api.search_places',
  'shotright.api.find_places',
  'shotright.api.google_place_search',
]

export const PLACE_DETAIL_METHODS = [
  'shotright.api.get_place_details',
  'shotright.api.google_place_details',
]

/** Where a claimed listing is already on someone else's account. */
export const PLACE_TAKEN = 'place-taken'

/**
 * One search hit, normalised.
 *
 * Deliberately thin: an id, a name, an address. Enough to tell two branches of
 * the same franchise apart on a list and nothing more, because a search result
 * is not a thing we are allowed to keep.
 */
const normaliseHit = (raw, index) => ({
  id: raw?.place_id || raw?.id || raw?.name || `place-${index}`,
  name: raw?.display_name || raw?.displayName || raw?.name || raw?.title || '',
  address: raw?.formatted_address || raw?.formattedAddress || raw?.address || '',
  /* If the bench tells us a listing is already claimed we say so on the row
     rather than at the end — finding out after picking is a wasted step. */
  claimed: Boolean(raw?.claimed || raw?.already_claimed),
})

/**
 * The detail of one place, reduced to what a form can hold.
 *
 * Note what is NOT read, on purpose: `rating`, `userRatingCount`, `reviews`,
 * `photos`, `generativeSummary`, and the atmosphere attributes. Some of those
 * would be genuinely useful — the atmosphere flags are close to a ready-made
 * mood taxonomy — and every one of them is content we may not keep. Reading
 * them here would put them one careless `...place` away from a database column,
 * so they are not read at all.
 */
const normaliseDetail = (raw) => {
  if (!raw) return null
  const location = raw.location || raw.geometry?.location || {}
  return {
    placeId: raw.place_id || raw.id || '',
    name: raw.display_name || raw.displayName || raw.name || '',
    address: raw.formatted_address || raw.formattedAddress || raw.address || '',
    latitude: Number(location.latitude ?? location.lat ?? raw.latitude) || null,
    longitude: Number(location.longitude ?? location.lng ?? raw.longitude) || null,
    phone: raw.phone || raw.national_phone_number || raw.nationalPhoneNumber || '',
    /* Day rows in our own shape if the bench has done the mapping, otherwise
       nothing. We do NOT parse Google's opening-hours format here: getting it
       subtly wrong writes bad trading hours onto a real business, and a partner
       who trusts the prefill will not re-read all seven days. */
    hours: Array.isArray(raw.operating_hours) ? raw.operating_hours : null,
    /** Whatever attribution string the proxy hands us, shown verbatim. */
    attribution: raw.attribution || raw.attributions || '',
  }
}

/**
 * @returns `{available, results, method}` — `available: false` means we could
 *          not ask, which is NOT the same as "no venue by that name". The
 *          search box only appears when this is available, so the distinction
 *          is mostly about never rendering an empty result list over a failure.
 */
export const searchPlaces = async (query, { near, probe = false } = {}) => {
  const text = String(query || '').trim()
  /* Two characters is not a search, it is a keystroke. `probe` is the one
     exception — see `placesAvailable`. */
  if (!probe && text.length < 3) return { available: true, results: [] }

  if (USE_MOCKS) {
    const rows = (await import('./mockBackend')).mockBackend.searchPlaces?.(text) || []
    return { available: true, results: (await rows).map(normaliseHit) }
  }

  const params = { query: text, q: text }
  if (near?.latitude && near?.longitude) {
    params.latitude = near.latitude
    params.longitude = near.longitude
  }

  for (const method of PLACE_SEARCH_METHODS) {
    let payload
    try {
      payload = await withFallback(
        method,
        async () => await callGet(method, params),
        async () => undefined,
      )
    } catch (error) {
      return { available: false, results: [], errored: true, error, method }
    }
    if (payload === undefined) continue

    const rows = Array.isArray(payload) ? payload : payload?.results || payload?.places || []
    return { available: true, results: rows.map(normaliseHit), method }
  }

  return { available: false, results: [] }
}

/**
 * Fetch one place's details — the only billable call in the flow, and it fires
 * on a deliberate pick rather than on a keystroke.
 *
 * @returns `{ok, place}` or `{ok: false, reason}`. `reason: PLACE_TAKEN` means
 *          another account has already claimed that listing, which is a real
 *          answer and not an error — see the venue-claiming note in §20.
 */
export const getPlaceDetails = async (placeId) => {
  if (!placeId) return { ok: false, reason: 'no-place' }

  if (USE_MOCKS) {
    const raw = await (await import('./mockBackend')).mockBackend.placeDetails?.(placeId)
    return raw ? { ok: true, place: normaliseDetail(raw) } : { ok: false, reason: 'not-found' }
  }

  for (const method of PLACE_DETAIL_METHODS) {
    let payload
    try {
      payload = await withFallback(
        method,
        async () => await callGet(method, { place_id: placeId }),
        async () => undefined,
      )
    } catch (error) {
      /* A claimed listing comes back as a refusal. Distinguished here because
         "someone else has this venue" and "the lookup broke" need completely
         different sentences — one is a support conversation, the other is a
         retry. */
      const text = `${error?.message || ''} ${error?.detail || ''}`
      if (/already claimed|already registered|another account/i.test(text)) {
        return { ok: false, reason: PLACE_TAKEN }
      }
      return { ok: false, reason: 'errored', error }
    }
    if (payload === undefined) continue

    const place = normaliseDetail(payload)
    return place?.placeId || place?.name
      ? { ok: true, place, method }
      : { ok: false, reason: 'not-found' }
  }

  return { ok: false, reason: 'no-endpoint' }
}

/**
 * Which fields a place can fill, and what we call them on the form.
 *
 * Used to mark provenance so every prefilled value carries "we put this here,
 * check it" — the same contract the smart-defaults chips already make. A value
 * we filled in and did not mark is a value the partner will publish without
 * reading.
 */
export const PLACE_FIELDS = {
  venue_name: 'name',
  address: 'address',
  contact_number: 'phone',
}

export const applyPlace = (values, place) => {
  const next = { ...values }
  const filled = []
  for (const [field, key] of Object.entries(PLACE_FIELDS)) {
    const incoming = place?.[key]
    if (!incoming) continue
    next[field] = incoming
    filled.push(field)
  }
  if (place?.latitude && place?.longitude) {
    next.latitude = place.latitude
    next.longitude = place.longitude
    filled.push('location')
  }
  /* The ONE piece of Google data that is ours to keep. It is also what lets a
     second partner claiming the same restaurant be spotted server-side. */
  next.place_id = place?.placeId || ''
  return { values: next, filled }
}

/**
 * Is the accelerator available AT ALL?
 *
 * Asked once, on mount, before anything is rendered — because "no dead search
 * box" cannot be honoured by reacting to the first failed search. A partner who
 * types their venue name into a box that was never going to work has been sent
 * on an errand by a feature that does not exist on their server.
 *
 * The probe is a search with an empty query, which the proxy answers with an
 * empty list (see §20). Text search is the free, unlimited SKU and
 * `withFallback` caches the verdict per tab, so this costs one request per
 * session and nothing at all on a bench where the method is absent after the
 * first look.
 */
export const placesAvailable = async () => {
  if (USE_MOCKS) return true

  /**
   * All candidates at once, not one after another.
   *
   * `searchPlaces` walks the list sequentially, which is right for a real
   * search — the first deployed name wins and the rest are never called. For a
   * MOUNT probe it is wrong: on a bench with none of them it costs three
   * round-trips of latency on a step the partner is waiting to use, and that
   * delay was measurable enough to destabilise a browser suite that had been
   * green for weeks.
   *
   * Asking in parallel costs the same number of requests and one round-trip of
   * time. `withFallback` still caches each verdict, so the real search that
   * follows a keystroke pays for none of this.
   */
  const answers = await Promise.all(
    PLACE_SEARCH_METHODS.map((method) =>
      withFallback(
        method,
        async () => {
          await callGet(method, { query: '', q: '' })
          return true
        },
        async () => false,
      ).catch(() => false),
    ),
  )
  return answers.some(Boolean)
}

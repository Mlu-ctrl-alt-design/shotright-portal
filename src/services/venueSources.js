import { call, USE_MOCKS } from './api'
import { withFallback } from './vendor'
import { placesAvailable } from './places'

/**
 * Where a venue's details can be imported FROM.
 *
 * The add-venue redesign opens on one question — "start with your existing
 * listing" — offering four routes: a Google listing, a Facebook or Instagram
 * page, the venue's own website, and a spreadsheet of many venues.
 *
 * ============================================================================
 * ONLY ROUTES THAT ACTUALLY WORK ARE OFFERED
 * ============================================================================
 *
 * This is the fourth rule from `places.js`, applied to all of them:
 *
 *   > A bench without the proxy gets the wizard exactly as it is today, with no
 *   > dead search box and no explanation owed to anybody.
 *
 * All three routes exist on the bench (shotright #64). The Google one still
 * hides itself until the bench has a `google_places_api_key`: its probe fails
 * without one.
 *
 * A screen that offers a partner three ways to skip the typing, accepts their
 * Instagram URL into a box, and then does nothing is worse than never having
 * offered — they have now spent the time AND lost the trust. So each route is
 * probed, absent routes are not rendered, and if no single-venue route answers,
 * the import screen does not appear and the partner goes straight to the form.
 *
 * The backend contract (docs/API.md, "Venue import"):
 *
 *   search_places / get_place_details   the Places proxy — see `places.js`.
 *   import_venue_from_url(url, source)  ONE method for both the social and the
 *                                       website route. They are the same job —
 *                                       fetch a page, pull out name, address,
 *                                       phone, hours — and splitting them into
 *                                       two endpoints buys nothing but a second
 *                                       thing to deploy. `source` is a hint
 *                                       ('social' | 'website'), not a contract.
 *
 * The return is `normaliseImported`'s input below. A page that only shows its
 * content to logged-in readers (Instagram, always) comes back `blocked`, with
 * the bench's own sentence in `message`. What lands in a Venue is what the
 * partner submitted having read it.
 */

export const IMPORT_URL_METHOD = 'shotright.api.import_venue_from_url'

export const SOURCE = {
  GOOGLE: 'google',
  SOCIAL: 'social',
  WEBSITE: 'website',
  BULK: 'bulk',
}

/**
 * One imported venue, reduced to what the form can hold.
 *
 * Deliberately the same shape `normaliseDetail` produces in `places.js`, so the
 * form's prefill path does not care which route filled it in.
 */
export const normaliseImported = (raw) => {
  if (!raw) return null
  const location = raw.location || raw.geometry?.location || {}
  return {
    placeId: raw.place_id || raw.id || '',
    name: raw.display_name || raw.displayName || raw.name || raw.venue_name || '',
    address: raw.formatted_address || raw.formattedAddress || raw.address || '',
    latitude: Number(location.latitude ?? location.lat ?? raw.latitude) || null,
    longitude: Number(location.longitude ?? location.lng ?? raw.longitude) || null,
    phone: raw.phone || raw.national_phone_number || raw.nationalPhoneNumber || '',
    hours: Array.isArray(raw.operating_hours) ? raw.operating_hours : null,
    attribution: raw.attribution || raw.attributions || '',
    /* Image URLs off the partner's own page (shotright #64). Suggestions only:
       nothing is fetched until they tick the ones to use and confirm they are
       theirs. A Google place never has any — its photos may not be kept. */
    photoSuggestions: Array.isArray(raw.photo_suggestions)
      ? raw.photo_suggestions.filter((url) => /^https?:\/\//.test(String(url)))
      : [],
  }
}

export const IMPORT_PHOTOS_METHOD = 'shotright.api.save_imported_photos'

/**
 * Store the suggested photos the partner confirmed are theirs, as unattached
 * files the wizard holds until create_venue links them — the same thing the
 * wizard's own uploads are.
 *
 * @returns the saved ones in the photo tile's shape; failures are left out.
 */
export const importPhotos = async (urls) => {
  const rows = (await call(IMPORT_PHOTOS_METHOD, { urls, confirm_rights: 1 })) || []
  return rows
    .filter((row) => row.saved && row.file_url)
    .map(({ name, file_url, file_name, attached }) => ({ name, file_url, file_name, attached: Boolean(attached) }))
}

/**
 * Pull a venue's details off a Facebook / Instagram page or a website.
 *
 * @returns `{ok, venue}` | `{ok: false, reason, message?}` where reason is
 *          'no-endpoint' (not deployed), 'not-found' (nothing readable at that
 *          URL), 'blocked' (a login wall; `message` says what to do), 'locked'
 *          (a Pro feature this account does not have) or 'errored'.
 */
export const importFromUrl = async (url, source) => {
  const text = String(url || '').trim()
  if (!text) return { ok: false, reason: 'no-url' }
  if (USE_MOCKS) return { ok: false, reason: 'no-endpoint' }

  try {
    return await withFallback(
      IMPORT_URL_METHOD,
      async () => {
        const payload = await call(IMPORT_URL_METHOD, { url: text, source })
        if (payload?.blocked) return { ok: false, reason: 'blocked', message: payload.message || '' }
        const venue = normaliseImported(payload)
        return venue?.name || venue?.address
          ? { ok: true, venue }
          : { ok: false, reason: 'not-found' }
      },
      async () => ({ ok: false, reason: 'no-endpoint' }),
    )
  } catch (error) {
    const text = `${error?.excType || error?.exc_type || ''} ${error?.message || ''} ${error?.detail || ''}`
    if (/FeatureLockedError/.test(text)) return { ok: false, reason: 'locked', error }
    return { ok: false, reason: 'errored', error }
  }
}

/**
 * Is the URL importer deployed?
 *
 * Probed with an empty URL, the same trick `placesAvailable` uses: the method
 * either resolves (and answers nothing useful, which is fine — we only wanted
 * to know it exists) or it does not resolve at all. `withFallback` caches the
 * verdict per tab, so this costs one request per session.
 */
export const urlImportAvailable = async () => {
  if (USE_MOCKS) return false
  return withFallback(
    IMPORT_URL_METHOD,
    async () => {
      await call(IMPORT_URL_METHOD, { url: '', source: 'probe' })
      return true
    },
    async () => false,
  ).catch(() => false)
}

/**
 * Which import routes this bench can actually offer.
 *
 * `bulk` is not probed: it is built on `save_venue_draft`, which the portal
 * already uses and already falls back to browser storage for, so it works on
 * every bench. It is the one route here that is not waiting on anybody.
 */
export const availableSources = async () => {
  const [google, url] = await Promise.all([
    placesAvailable().catch(() => false),
    urlImportAvailable(),
  ])
  return {
    [SOURCE.GOOGLE]: Boolean(google),
    [SOURCE.SOCIAL]: Boolean(url),
    [SOURCE.WEBSITE]: Boolean(url),
    [SOURCE.BULK]: true,
  }
}

/** Routes that fill in ONE venue — the ones the import screen exists for. */
export const SINGLE_VENUE_SOURCES = [SOURCE.GOOGLE, SOURCE.SOCIAL, SOURCE.WEBSITE]

export const hasSingleVenueSource = (sources) =>
  SINGLE_VENUE_SOURCES.some((key) => sources?.[key])

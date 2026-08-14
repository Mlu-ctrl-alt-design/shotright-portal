import { loadGoogleMaps } from './googleMaps'

/**
 * Address suggestions, from Google when it is configured and OpenStreetMap when
 * it is not.
 *
 * ONE SHAPE OUT, whichever answered:
 *
 *   { id, label, latitude, longitude, source }
 *
 * `latitude`/`longitude` may be null on a Google suggestion — Google's
 * autocomplete returns predictions WITHOUT a location, and getting one is a
 * second call. That is why `resolve()` exists and why the component must call
 * it on pick rather than assuming the coordinates arrived with the list.
 * Nominatim returns coordinates inline, so its `resolve()` is a no-op. Callers
 * do not need to know which they got.
 *
 * ⚠️ WHY NOT THE NOMINATIM SHAPE EVERYWHERE. It was tempting to keep
 * `display_name`/`lat`/`lon` and have the Google path pretend. That is how the
 * moods bug happened — two sources describing one thing differently, and a
 * component written against whichever one the author had in front of them. One
 * normaliser, both sources, no `display_name` outside this file.
 *
 * BILLING. Autocomplete is billed per request, and cheaper per *session* when
 * predictions are followed by a Details call with a shared session token. We
 * pass a token through so the pairing is available; resolution goes via the
 * Geocoder, which is a simpler call than PlacesService and needs no map
 * instance. If the bill ever justifies it, switching resolution to
 * `PlacesService.getDetails` with the same token is a change inside this file.
 */

/** ~25km, which covers a metropolitan area without excluding the far side. */
const BIAS_DEGREES = 0.25

/** A token ties a burst of keystrokes to the pick that ends it. */
export const newSessionToken = () => {
  const maps = window.google?.maps
  try {
    return maps?.places?.AutocompleteSessionToken
      ? new maps.places.AutocompleteSessionToken()
      : null
  } catch {
    return null
  }
}

const googleSuggest = async (maps, query, near, sessionToken) => {
  if (!maps?.places?.AutocompleteService) return null
  const service = new maps.places.AutocompleteService()

  const request = {
    input: query,
    /* South Africa only, matching what the OSM path has always done. A partner
       listing a venue abroad is not a case this product has. */
    componentRestrictions: { country: 'za' },
    ...(sessionToken ? { sessionToken } : {}),
  }
  if (near?.coords) {
    request.locationBias = {
      north: near.coords.latitude + BIAS_DEGREES,
      south: near.coords.latitude - BIAS_DEGREES,
      east: near.coords.longitude + BIAS_DEGREES,
      west: near.coords.longitude - BIAS_DEGREES,
    }
  }

  const predictions = await new Promise((resolve) => {
    service.getPlacePredictions(request, (results, status) => {
      /* ZERO_RESULTS is a real answer and must not read as an outage — the
         difference between "no such address" and "we could not ask" is the
         same distinction this codebase draws everywhere else. */
      if (status === maps.places.PlacesServiceStatus.OK && results) resolve(results)
      else if (status === maps.places.PlacesServiceStatus.ZERO_RESULTS) resolve([])
      else resolve(null)
    })
  })
  if (!predictions) return null

  return predictions.map((p) => ({
    id: p.place_id,
    label: p.description,
    latitude: null,
    longitude: null,
    source: 'google',
  }))
}

const osmSuggest = async (query, near, signal) => {
  const box =
    near?.coords && near.prompt
      ? `&viewbox=${near.coords.longitude - BIAS_DEGREES},${near.coords.latitude + BIAS_DEGREES},` +
        `${near.coords.longitude + BIAS_DEGREES},${near.coords.latitude - BIAS_DEGREES}&bounded=0`
      : ''

  const url =
    'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5' +
    '&countrycodes=za' +
    box +
    '&q=' +
    encodeURIComponent(query)

  const rows = await fetch(url, { signal, headers: { Accept: 'application/json' } }).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })

  return rows.map((r) => ({
    id: r.place_id ?? `${r.lat},${r.lon}`,
    label: r.display_name,
    latitude: Number(Number(r.lat).toFixed(6)),
    longitude: Number(Number(r.lon).toFixed(6)),
    source: 'osm',
  }))
}

/**
 * @returns a list of suggestions, or `null` if the lookup failed.
 *
 * `[]` and `null` are different and callers must keep them different: an empty
 * list means "no address like that", and null means "we could not ask". The
 * first is the partner's cue to try different wording; the second is ours to
 * own, and it must never stop them typing the address by hand.
 */
export async function suggestAddresses(query, { near, sessionToken, signal } = {}) {
  const maps = await loadGoogleMaps()
  if (maps) {
    const hits = await googleSuggest(maps, query, near, sessionToken).catch(() => null)
    /* A Google failure falls through to OSM rather than to nothing. The address
       field decides whether a venue is findable; it does not get to be down
       because one provider is. */
    if (hits) return hits
  }
  try {
    return await osmSuggest(query, near, signal)
  } catch (err) {
    if (err?.name === 'AbortError') return null
    return null
  }
}

/**
 * Turn a picked suggestion into an address WITH coordinates.
 *
 * OSM already carries them. Google needs a second call, and this is the one
 * that matters: a suggestion accepted without coordinates produces a venue with
 * an address and no point, which looks completely saved and is invisible to
 * every customer, because search is a radius query. Silent invisibility is the
 * worst failure this field has.
 */
export async function resolveSuggestion(option) {
  if (!option) return null
  if (Number.isFinite(option.latitude) && Number.isFinite(option.longitude)) {
    return { address: option.label, latitude: option.latitude, longitude: option.longitude }
  }

  const maps = await loadGoogleMaps()
  if (!maps?.Geocoder) return { address: option.label, latitude: null, longitude: null }

  const geocoder = new maps.Geocoder()
  const located = await new Promise((resolve) => {
    geocoder.geocode({ placeId: option.id }, (results, status) => {
      if (status === 'OK' && results?.[0]?.geometry?.location) resolve(results[0])
      else resolve(null)
    })
  }).catch(() => null)

  if (!located) return { address: option.label, latitude: null, longitude: null }

  const point = located.geometry.location
  return {
    address: located.formatted_address || option.label,
    latitude: Number(point.lat().toFixed(6)),
    longitude: Number(point.lng().toFixed(6)),
  }
}

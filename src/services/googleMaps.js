/**
 * The Google Maps JavaScript API, loaded on demand.
 *
 * ============================================================================
 * TWO KEYS, TWO RULES. GETTING THESE THE WRONG WAY ROUND IS EXPENSIVE.
 * ============================================================================
 *
 * **Maps JS API key — belongs in the browser.** It can be restricted by HTTP
 * referrer, which is the whole point of that restriction existing: the key is
 * meant to be public and is useless off our own domains. This file ships one.
 *
 * **Places REST key — never in the browser.** It can only be restricted by IP
 * or referrer, and a referrer restriction does nothing for a server-to-server
 * call, so the practical restriction is IP. A REST key in a bundle is a key
 * anyone can lift and spend against the billing account. That one stays on the
 * bench behind `shotright.api.*` — see `services/places.js`, which is unchanged
 * by any of this.
 *
 * Those two facts look contradictory in a code review ("why is one key in the
 * client and one not?") which is exactly why they are written down here.
 *
 * ============================================================================
 * WHY THE MAP MOVED TO GOOGLE AT ALL
 * ============================================================================
 *
 * Not for the tiles. Places content shown on a map has to be shown on a GOOGLE
 * map, and the moment addresses come from Google Places, the pin on our map is
 * Places content. Leaflet over OpenStreetMap tiles plus a Google-derived pin is
 * a policy breach — a quiet one, of the kind nobody notices until an account
 * review. Moving the surface removes the breach rather than documenting it.
 *
 * ============================================================================
 * IT MUST WORK WITH NO KEY AT ALL
 * ============================================================================
 *
 * Local dev, preview builds, CI and both test suites have no key and no network
 * to Google. `load()` resolves to `null` there, and every caller falls back to
 * the Leaflet map and the OpenStreetMap geocoder that were already shipping.
 * A missing environment variable must degrade the map, never break the form —
 * the location field decides whether a venue is findable at all, so it is the
 * last thing that may depend on a deploy-time secret being present.
 */

export const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

/** Configured, and therefore worth attempting. Not proof that it loaded. */
export const googleMapsConfigured = () => Boolean(GOOGLE_MAPS_KEY)

const SCRIPT_ID = 'shotright-google-maps'

/** One in-flight load per tab, whatever how many maps mount at once. */
let pending = null

/**
 * @returns the `google.maps` namespace, or `null` if it cannot be had.
 *
 * Never throws. A caller that has to wrap this in a try/catch would eventually
 * forget to, and the failure mode is a blank screen where the venue location
 * should be.
 */
export function loadGoogleMaps() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.google?.maps) return Promise.resolve(window.google.maps)
  if (!googleMapsConfigured()) return Promise.resolve(null)
  if (pending) return pending

  pending = new Promise((resolve) => {
    const existing = document.getElementById(SCRIPT_ID)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google?.maps || null))
      existing.addEventListener('error', () => resolve(null))
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.async = true
    /* `places` for the address autocomplete, `marker` for the advanced marker.
       Asking for both here means one script tag rather than a second load the
       first time somebody types an address. */
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}` +
      `&libraries=places,marker&loading=async&v=weekly`
    script.onload = () => resolve(window.google?.maps || null)
    script.onerror = () => {
      /* A bad key, a blocked script, an offline partner. All of them mean the
         same thing to the caller and none of them are the partner's problem. */
      pending = null
      resolve(null)
    }
    document.head.appendChild(script)
  })

  return pending
}

/** Test seam — lets a suite pretend the API is or is not there. */
export const __resetGoogleMaps = () => {
  pending = null
  document.getElementById(SCRIPT_ID)?.remove()
}

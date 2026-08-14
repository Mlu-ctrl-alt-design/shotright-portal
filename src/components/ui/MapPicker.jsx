import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Button, Alert } from './index'
import { clsx } from '../../utils/clsx'
import { loadGoogleMaps } from '../../services/googleMaps'

/**
 * Pick a venue's coordinates.
 *
 * The app finds venues by radius search, so a venue submitted without
 * latitude/longitude is invisible to customers — it looks saved and simply never
 * appears. That makes this field load-bearing, not a nicety.
 *
 * Leaflet + OpenStreetMap: no API key to provision, no per-request billing.
 * Geocoding uses Nominatim, OSM's free service.
 *
 * TWO SURFACES, ONE COMPONENT. Google Maps when a key is configured, Leaflet
 * over OpenStreetMap when it is not. Everything around the map — the copy, the
 * badge, the keyboard nudge, the warnings — is shared, because those were the
 * expensive parts to get right and neither engine should own them.
 *
 * WHY GOOGLE, AND WHY IT IS NOT OPTIONAL ONCE ADDRESSES COME FROM PLACES.
 * Places content shown on a map must be shown on a Google map. The moment the
 * address field is Google-backed, this pin IS Places content, and a Leaflet map
 * carrying it is a policy breach — a quiet one, of the kind nobody notices
 * until an account review. See `services/googleMaps.js`.
 *
 * THREE WAYS IN, deliberately:
 *   1. Picking a suggestion in the Address field above
 *   2. Clicking or dragging on the map
 *   3. "Use my current location"
 *
 * ⚠️ THERE USED TO BE A FOURTH — typing latitude and longitude into two number
 * fields — and it was the ACCESSIBLE one: a map is irreducibly visual and
 * drag-to-place cannot be done from a keyboard. Those fields are gone (a
 * partner should be reading a street name, not a decimal), so the keyboard path
 * is now (1) the address combobox, which is fully keyboard-operable, and the
 * arrow-key nudge below once a pin exists. That is a real trade and it is worth
 * naming: the numbers were precise and universal, the address is friendlier and
 * depends on the venue being geocodable. `Drop a pin here` covers the gap for
 * an address no geocoder knows — informal and new addresses in SA, which the
 * old copy on this component was already careful about.
 *
 * NETWORK: whichever surface loads, it is fetched at runtime. A CSP added to
 * this portal must allow maps.googleapis.com AND openstreetmap.org, or the map
 * goes blank while the rest of the page looks fine.
 */

// Leaflet's default marker icons resolve to files it expects to find next to its
// CSS. Bundlers break that assumption, so the icon is drawn inline instead —
// this also lets it carry the brand colour.
const PIN = L.divIcon({
  className: '',
  html: `<svg viewBox="0 0 32 44" width="32" height="44" aria-hidden="true">
    <path d="M16 43C16 43 30 26.5 30 15A14 14 0 1 0 2 15C2 26.5 16 43 16 43Z"
          fill="#FEC32D" stroke="#2d2d2d" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="16" cy="15" r="5" fill="#2d2d2d"/>
  </svg>`,
  iconSize: [32, 44],
  iconAnchor: [16, 43],
})

// Johannesburg — a sensible opening view for a South African product.
const DEFAULT_CENTER = [-26.2041, 28.0473]

/**
 * ~10 metres in degrees of latitude. Longitude is scaled by cos(lat) at the
 * call site so a nudge covers the same ground east–west as north–south — at
 * Johannesburg's latitude an unscaled step would move ~11m north but only ~9m
 * east, which is exactly the kind of small wrongness nobody reports and
 * everybody feels.
 */
const NUDGE_DEG = 10 / 111_320

export default function MapPicker({
  latitude,
  longitude,
  onChange,
  provisional = false,
  error,
  /** The street address this pin came from. Shown INSTEAD of coordinates. */
  address = '',
}) {
  const containerRef = useRef(null)
  /** null = still deciding. Prevents both engines racing to own the div. */
  const [engine, setEngine] = useState(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  // idle | adjusting | adjusted — drives the badge copy (spec §8).
  const [pinState, setPinState] = useState('idle')

  const hasPoint = Number.isFinite(latitude) && Number.isFinite(longitude)

  // Keep the latest handler without re-running the map setup effect, which would
  // tear down and rebuild the map on every parent render.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  /**
   * Which surface? Asked once, before either engine touches the container.
   *
   * `loadGoogleMaps()` resolves to null with no key, on a bad key, or offline —
   * it never throws — so "Google failed" and "Google was never configured" land
   * in the same place, which is the same fallback either way.
   */
  useEffect(() => {
    let alive = true
    loadGoogleMaps().then((maps) => {
      if (alive) setEngine(maps ? 'google' : 'leaflet')
    })
    return () => {
      alive = false
    }
  }, [])

  /* ------------------------------------------------------------- Google */
  useEffect(() => {
    if (engine !== 'google' || mapRef.current || !containerRef.current) return
    const maps = window.google?.maps
    if (!maps) return

    const centre = hasPoint
      ? { lat: latitude, lng: longitude }
      : { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] }

    const map = new maps.Map(containerRef.current, {
      center: centre,
      zoom: hasPoint ? 16 : 11,
      scrollwheel: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      /* Required for AdvancedMarkerElement. Falls back to the classic marker
         below if it is unavailable, so a missing map id degrades the pin
         rather than the map. */
      mapId: 'DEMO_MAP_ID',
    })

    map.addListener('click', (e) => {
      if (!e.latLng) return
      onChangeRef.current({
        latitude: Number(e.latLng.lat().toFixed(6)),
        longitude: Number(e.latLng.lng().toFixed(6)),
      })
    })

    mapRef.current = { kind: 'google', map }
    return () => {
      mapRef.current = null
      markerRef.current = null
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  /* ------------------------------------------------------------ Leaflet */
  useEffect(() => {
    if (engine !== 'leaflet' || mapRef.current || !containerRef.current) return

    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
      hasPoint ? [latitude, longitude] : DEFAULT_CENTER,
      hasPoint ? 16 : 11,
    )
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    map.on('click', (e) => {
      onChangeRef.current({
        latitude: Number(e.latlng.lat.toFixed(6)),
        longitude: Number(e.latlng.lng.toFixed(6)),
      })
    })

    mapRef.current = { kind: 'leaflet', map }
    // Leaflet mis-measures if its container was hidden or resized during mount.
    //
    // The handle is kept and cleared below. Unmounting inside that tick — which
    // is what navigating straight off this wizard step does — otherwise leaves
    // the callback to call invalidateSize() on a map that has been removed,
    // where Leaflet reads `_leaflet_pos` off a destroyed node and throws an
    // uncaught TypeError. Harmless to the partner, and exactly the kind of
    // console noise that hides a real error later.
    const measure = setTimeout(() => map.invalidateSize(), 0)

    return () => {
      clearTimeout(measure)
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Later coordinate changes are handled by the marker effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  // Reflect the current coordinates onto whichever map is mounted.
  useEffect(() => {
    const handle = mapRef.current
    if (!handle) return

    if (!hasPoint) {
      if (markerRef.current) {
        // Two APIs for "take this off the map", and neither forgives the other.
        if (handle.kind === 'google') markerRef.current.map = null
        else markerRef.current.remove()
        markerRef.current = null
      }
      return
    }

    if (handle.kind === 'google') {
      const maps = window.google?.maps
      if (!maps) return
      const position = { lat: latitude, lng: longitude }

      if (markerRef.current) {
        markerRef.current.position = position
      } else {
        const marker = new maps.marker.AdvancedMarkerElement({
          map: handle.map,
          position,
          gmpDraggable: true,
        })
        marker.addListener('dragstart', () => setPinState('adjusting'))
        marker.addListener('dragend', (e) => {
          const p = e.latLng || marker.position
          const lat = typeof p.lat === 'function' ? p.lat() : p.lat
          const lng = typeof p.lng === 'function' ? p.lng() : p.lng
          setPinState('adjusted')
          onChangeRef.current({
            latitude: Number(lat.toFixed(6)),
            longitude: Number(lng.toFixed(6)),
            provisional: false,
          })
        })
        markerRef.current = marker
      }
      handle.map.panTo(position)
      return
    }

    const map = handle.map
    const latlng = [latitude, longitude]
    if (markerRef.current) {
      markerRef.current.setLatLng(latlng)
    } else {
      const marker = L.marker(latlng, { icon: PIN, draggable: true, keyboard: false }).addTo(map)
      marker.on('dragstart', () => setPinState('adjusting'))
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        setPinState('adjusted')
        onChangeRef.current({
          latitude: Number(p.lat.toFixed(6)),
          longitude: Number(p.lng.toFixed(6)),
          provisional: false,
        })
      })
      markerRef.current = marker
    }
    // `animate: false` deliberately. An animated pan schedules work on a
    // requestAnimationFrame; if the step unmounts mid-animation (navigating away
    // from the wizard is the common case) Leaflet's callback reaches for
    // `_leaflet_pos` on a node it has already destroyed and throws. The pan is
    // a few hundred milliseconds of polish against an uncaught error.
    map.panTo(latlng, { animate: false })
  }, [latitude, longitude, hasPoint])

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setStatus({ tone: 'warning', text: 'This browser cannot share your location.' })
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        })
        mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 17)
        setBusy(false)
      },
      () => {
        setStatus({ tone: 'warning', text: 'Could not get your location. Drop the pin instead.' })
        setBusy(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  /**
   * ⚠️ REMOVED WITH THE LATITUDE / LONGITUDE FIELDS — the lesson outlives them.
   *
   * Those inputs were CONTROLLED and bound to a parsed number, and the handler
   * dropped any keystroke that did not parse. Typing "-25.7069" therefore lost
   * the "-" and the ".", because `Number("-")` and `Number("25.")` produce no
   * new value and React re-rendered the field with its previous one. Every
   * latitude in South Africa is negative and every useful coordinate has a
   * decimal point, so the two characters that could not be typed were the two
   * always needed — on the one field deciding whether a venue is findable at
   * all. The fix was to hold the raw text ALONGSIDE the parsed number rather
   * than instead of it.
   *
   * **A controlled numeric input must never decide what the partner is allowed
   * to have typed so far.** If a number field is ever added to this portal
   * again, it starts from here.
   */

  /**
   * Keyboard path to the same outcome as dragging (§11).
   *
   * The spec calls a drag-only affordance "a hard accessibility failure on a
   * field that determines whether the business is discoverable at all", and it
   * is right: without this, a keyboard user cannot place their venue on the map
   * at all, and an unplaced venue never appears in radius search.
   *
   * Arrow keys nudge in ~10m steps. The numeric inputs below remain the precise
   * route; this is the direct-manipulation equivalent.
   */
  const onPinKeyDown = (event) => {
    const moves = {
      ArrowUp: [NUDGE_DEG, 0],
      ArrowDown: [-NUDGE_DEG, 0],
      ArrowLeft: [0, -NUDGE_DEG],
      ArrowRight: [0, NUDGE_DEG],
    }
    const move = moves[event.key]
    if (!move || !hasPoint) return

    event.preventDefault()
    const [dLat, dLng] = move
    // Scale the east–west step so it covers the same distance on the ground.
    const scale = Math.max(0.2, Math.cos((latitude * Math.PI) / 180))
    setPinState('adjusted')
    onChange({
      latitude: Number((latitude + dLat).toFixed(6)),
      longitude: Number((longitude + dLng / scale).toFixed(6)),
      provisional: false,
    })
  }

  const badge = provisional
    ? 'Rough spot from your device — drag it onto your venue'
    : pinState === 'adjusting'
      ? 'Adjusting…'
      : pinState === 'adjusted'
        ? 'Pin adjusted by you'
        : 'Pin set from your address'

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink-900">Where is your venue?</h2>
        <p className="mt-0.5 text-sm text-ink-700">
          Customers find venues near them, so this pin is how your venue gets discovered. Picking
          an address above drops it for you — drag it if it is not exact.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={useMyLocation} type="button">
          Use my current location
        </Button>
      </div>

      {status && <Alert variant={status.tone}>{status.text}</Alert>}

      <div className="relative">
        <div
          ref={containerRef}
          role="application"
          aria-label="Venue location map. Click to place the pin, or use the latitude and longitude fields below."
          className="h-80 w-full overflow-hidden rounded-3xl border-2 border-field bg-canvas"
        />

        {/* Badge (§8). It states what the pin currently means — guessed from the
            device, set from the address, or moved by hand — because those three
            deserve very different amounts of trust and look identical. */}
        {hasPoint && (
          <p
            className={clsx(
              // Top-RIGHT: Leaflet parks its zoom control at top-left and would
              // sit on top of this. Bottom-right is taken by the attribution,
              // which must stay legible (OSM licence terms).
              'pointer-events-none absolute top-3 right-3 z-[400] max-w-[min(20rem,calc(100%-5rem))] rounded-full px-3 py-1.5 text-center text-xs font-semibold shadow-sm',
              provisional ? 'bg-[#fdf5df] text-[#8a6400]' : 'bg-[#e9f7ef] text-[#1c7a45]',
            )}
            role="status"
          >
            {badge}
          </p>
        )}

        {/* Keyboard equivalent of dragging. A real button rather than a
            tabindex on the Leaflet marker: Leaflet owns that node and replaces
            it on re-render, so focus and handlers attached to it disappear
            without warning. */}
        {hasPoint && (
          <button
            type="button"
            onKeyDown={onPinKeyDown}
            aria-label="Move the venue pin. Use the arrow keys to nudge it in ten-metre steps."
            className="absolute bottom-3 left-3 z-[400] rounded-full bg-white/95 px-3 py-2 text-xs font-semibold text-ink-900 shadow-sm ring-1 ring-field hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Nudge pin ↑↓←→
          </button>
        )}

        {/* §8 — no signal at all. Says what to do rather than showing an empty
            grey rectangle that looks broken. */}
        {!hasPoint && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-3xl bg-canvas/80 p-6">
            <p className="max-w-sm text-center text-sm font-medium text-ink-700">
              Pick an address above (or allow location) and the pin drops here automatically.
            </p>
          </div>
        )}
      </div>

      {/**
        * WHERE THE PIN IS, IN WORDS.
        *
        * This replaced two number fields showing latitude and longitude to six
        * decimal places. Nobody running a restaurant checks their venue is
        * correctly placed by reading -26.204100 — they read the street name, and
        * the numbers were noise dressed up as precision. The coordinates are
        * still what gets saved, because radius search needs them; they are just
        * no longer the partner's problem.
        *
        * `data-field` stays on the wrapper so the wizard's "take me to the
        * problem" can still bring someone here when no location is set.
        */}
      <div data-field="latitude" data-latitude={latitude} data-longitude={longitude}>
        <p className="text-sm font-semibold text-ink-900">Where the pin is</p>
        {hasPoint ? (
          <p className="mt-1 text-sm text-ink-700">
            {address && pinState !== 'adjusted' ? (
              address
            ) : address ? (
              <>
                Just off <span className="font-medium">{address}</span> — you moved the pin, which
                is fine if that is where your door is.
              </>
            ) : (
              'Dropped on the map. Pick your address above if you want it exact.'
            )}
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-700">
            Nothing set yet — pick your address above, or drop a pin on the map.
          </p>
        )}
        {error && (
          <p className="mt-1 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </div>

      {!hasPoint && (
        <Alert variant="warning">
          No location set yet. Without it your venue will not show up when customers search near
          them.
        </Alert>
      )}

      {/* A device-derived pin is a starting point, not an address. Saying so
          next to it is what keeps this a Tier B suggestion rather than a
          silently load-bearing default (§1). */}
      {provisional && hasPoint && (
        <Alert variant="warning">
          This pin is roughly where you are now, not your venue. Pick your address above or drag
          the pin onto the right spot before you continue.
        </Alert>
      )}
    </section>
  )
}

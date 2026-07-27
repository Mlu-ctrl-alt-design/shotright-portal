import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Button, Input, Alert } from './index'
import { clsx } from '../../utils/clsx'

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
 * THREE WAYS IN, deliberately:
 *   1. Picking a suggestion in the Address field above (which geocodes it)
 *   2. Clicking or dragging on the map
 *   3. Typing the numbers directly
 *
 * (3) is not a fallback for the impatient — it is the accessible path. A map is
 * irreducibly visual and drag-to-place cannot be done from a keyboard, so the
 * numeric inputs are the only route for some partners and are labelled as real
 * fields rather than hidden behind a toggle.
 *
 * NETWORK: tiles and geocoding are fetched from openstreetmap.org at runtime. If
 * a CSP is ever added to the portal it must allow those hosts, or the map goes
 * blank while the rest of the page looks fine.
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

export default function MapPicker({ latitude, longitude, onChange, provisional = false }) {
  const containerRef = useRef(null)
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

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return

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

    mapRef.current = map
    // Leaflet mis-measures if its container was hidden or resized during mount.
    setTimeout(() => map.invalidateSize(), 0)

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Runs once: later coordinate changes are handled by the marker effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect the current coordinates onto the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!hasPoint) {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
      return
    }

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
    map.panTo(latlng)
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

  const setCoord = (key) => (e) => {
    const raw = e.target.value
    setPinState('adjusted')
    if (raw === '') return onChange({ latitude, longitude, [key]: undefined, provisional: false })
    const n = Number(raw)
    if (Number.isFinite(n)) onChange({ latitude, longitude, [key]: n, provisional: false })
  }

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Latitude"
          inputMode="decimal"
          placeholder="-26.204100"
          value={latitude ?? ''}
          onChange={setCoord('latitude')}
        />
        <Input
          label="Longitude"
          inputMode="decimal"
          placeholder="28.047300"
          value={longitude ?? ''}
          onChange={setCoord('longitude')}
        />
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

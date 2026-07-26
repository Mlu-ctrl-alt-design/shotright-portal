import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Button, Input, Alert } from './index'

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
 *   1. Search the address (uses what the partner already typed on this step)
 *   2. Click or drag on the map
 *   3. Type the numbers directly
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

export default function MapPicker({ latitude, longitude, address, onChange }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

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
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        onChangeRef.current({
          latitude: Number(p.lat.toFixed(6)),
          longitude: Number(p.lng.toFixed(6)),
        })
      })
      markerRef.current = marker
    }
    map.panTo(latlng)
  }, [latitude, longitude, hasPoint])

  /** Geocode whatever the partner typed as the venue address. */
  const findAddress = async () => {
    if (!address?.trim()) {
      setStatus({ tone: 'warning', text: 'Add the venue address above first, then search for it.' })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const url =
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=za&q=' +
        encodeURIComponent(address)
      const results = await fetch(url, { headers: { Accept: 'application/json' } }).then((r) => {
        if (!r.ok) throw new Error(`Address lookup failed (${r.status}).`)
        return r.json()
      })
      if (!results.length) {
        setStatus({
          tone: 'warning',
          text: 'Could not find that address. Drop the pin on the map instead.',
        })
        return
      }
      const { lat, lon, display_name } = results[0]
      onChange({ latitude: Number(Number(lat).toFixed(6)), longitude: Number(Number(lon).toFixed(6)) })
      mapRef.current?.setView([Number(lat), Number(lon)], 17)
      setStatus({ tone: 'success', text: `Found: ${display_name}. Drag the pin if it is not exact.` })
    } catch (err) {
      setStatus({ tone: 'warning', text: `${err.message} Drop the pin on the map instead.` })
    } finally {
      setBusy(false)
    }
  }

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
    if (raw === '') return onChange({ latitude, longitude, [key]: undefined })
    const n = Number(raw)
    if (Number.isFinite(n)) onChange({ latitude, longitude, [key]: n })
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink-900">Where is your venue?</h2>
        <p className="mt-0.5 text-sm text-ink-700">
          Customers find venues near them, so this pin is how your venue gets discovered. Search
          your address, click the map, or type the coordinates.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={findAddress} loading={busy} type="button">
          Find my address
        </Button>
        <Button variant="ghost" onClick={useMyLocation} type="button">
          Use my current location
        </Button>
      </div>

      {status && <Alert variant={status.tone}>{status.text}</Alert>}

      <div
        ref={containerRef}
        role="application"
        aria-label="Venue location map. Click to place the pin, or use the latitude and longitude fields below."
        className="h-80 w-full overflow-hidden rounded-3xl border-2 border-brand-edge bg-canvas"
      />

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
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input } from './index'
import { getPlaceDetails, PLACE_TAKEN, placesAvailable, searchPlaces } from '../../services/places'

/**
 * "Is your venue already on Google?" — the first thing a wizard should ask
 * someone who has been trading for six years.
 *
 * THREE THINGS ABOUT THE SHAPE OF THIS COMPONENT, all of them load-bearing:
 *
 * 1. **Results are a LIST. They are never drawn on the map.** Places content
 *    shown on a map has to be on a Google map, and this portal draws Leaflet
 *    over OpenStreetMap tiles. That policy line is respected here by there
 *    being no code that could break it, rather than by a comment asking future
 *    readers to remember. Once a place is picked, the coordinate is the
 *    partner's own confirmed venue location and our pin is ours to draw.
 *
 * 2. **Searching is free; picking is not.** Text search returns identifiers and
 *    costs nothing. The detail call is the billable one, so it fires on a
 *    deliberate pick — never on a keystroke, never on a hover, and never
 *    speculatively for the whole result list.
 *
 * 3. **It is an accelerator, not a gate.** "I'll type it in myself" is always
 *    on screen and is never the smaller option. A venue that is not on Google —
 *    new, home-run, a pop-up — must not feel like a second-class listing, and
 *    a partner who does not want to be matched to a Google record should not
 *    have to explain themselves to a form.
 */
const DEBOUNCE_MS = 400

export default function PlaceSearch({ onPick, onSkip, near }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState({ status: 'idle', results: [] })
  const [picking, setPicking] = useState(null)
  const [problem, setProblem] = useState(null)
  /** null = not yet known. Nothing renders until it is. */
  const [supported, setSupported] = useState(null)
  const latest = useRef(0)

  /**
   * Ask before offering.
   *
   * Rendering the box and hiding it after the first search fails means a
   * partner types their venue name into something that was never going to work
   * — an errand set by a feature that is not on their server. So nothing is
   * shown until we know. One free call per tab; see `placesAvailable`.
   */
  useEffect(() => {
    let alive = true
    /**
     * Yield to the form before asking.
     *
     * The step this sits on lazy-loads a map, reads three lookups and applies
     * smart defaults on mount. Firing capability probes into the middle of that
     * competes with the thing the partner is actually waiting for — and it was
     * measurable: the browser suite that drives this step started losing a race
     * it had won for weeks, and only under the load of a full sweep.
     *
     * The search box appearing a beat after the form is the correct priority
     * anyway. Nobody is typing into it in the first half-second, and the form
     * behind it is what they came for.
     */
    const timer = setTimeout(() => {
      placesAvailable().then((ok) => alive && setSupported(ok))
    }, 750)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const text = query.trim()
    if (text.length < 3) {
      setState({ status: 'idle', results: [] })
      return
    }
    const token = ++latest.current
    setState((s) => ({ ...s, status: 'searching' }))

    const timer = setTimeout(async () => {
      const result = await searchPlaces(text, { near })
      // A slow response for an old query must never overwrite a newer one.
      if (token !== latest.current) return
      setState({
        status: result.available ? 'done' : 'unavailable',
        results: result.results || [],
      })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, near])

  const pick = async (hit) => {
    setPicking(hit.id)
    setProblem(null)
    const result = await getPlaceDetails(hit.id)
    setPicking(null)

    if (result.ok) return onPick(result.place)
    setProblem(result.reason)
  }

  /* Not deployed, still asking, or it broke mid-session. Either way this is an
     accelerator that is not available, and a partner has no use for that
     sentence — the form behind it works perfectly. Render nothing. */
  if (!supported || state.status === 'unavailable') return null

  return (
    <section className="rounded-2xl bg-canvas p-4" aria-labelledby="place-search-heading">
      <h3 id="place-search-heading" className="text-sm font-bold text-ink-900">
        Already on Google? Start from there.
      </h3>
      <p className="mt-1 text-sm text-ink-700">
        Search for your venue and we’ll fill in what we can. You’ll get to check every field before
        anything is saved.
      </p>

      <div className="mt-3">
        <Input
          label="Search for your venue"
          placeholder="e.g. Corner Kitchen, Long Street"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      {state.status === 'searching' && (
        <p className="mt-2 text-sm text-ink-500" role="status">
          Searching…
        </p>
      )}

      {state.status === 'done' && query.trim().length >= 3 && !state.results.length && (
        <p className="mt-2 text-sm text-ink-700">
          Nothing came back. Try the name on your signage, or fill the form in below.
        </p>
      )}

      {state.results.length > 0 && (
        /* A list. Deliberately not a map — see the note at the top. */
        <ul className="mt-3 divide-y divide-gray-200">
          {state.results.map((hit) => (
            <li key={hit.id} className="py-2">
              <button
                type="button"
                onClick={() => pick(hit)}
                disabled={hit.claimed || picking === hit.id}
                className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-white disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="block text-sm font-bold text-ink-900">{hit.name}</span>
                {hit.address && (
                  <span className="mt-0.5 block text-sm text-ink-700">{hit.address}</span>
                )}
                {hit.claimed && (
                  <span className="mt-1 block text-xs text-ink-500">
                    Already listed on Sho’t Right by another account
                  </span>
                )}
                {picking === hit.id && (
                  <span className="mt-1 block text-xs text-ink-500">Fetching the details…</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {problem && (
        <Alert variant="warning" className="mt-3">
          {problem === PLACE_TAKEN ? (
            <>
              <p className="font-bold">That venue is already on Sho’t Right</p>
              <p className="mt-1">
                Someone has listed this already. If it’s yours, get in touch — a second listing
                splits your bookings.
              </p>
            </>
          ) : (
            <>
              <p className="font-bold">We couldn’t fetch that one</p>
              <p className="mt-1">
                Nothing has been filled in. Try another result, or fill the form in below — it works
                exactly the same.
              </p>
            </>
          )}
        </Alert>
      )}

      {onSkip && (
        <Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={onSkip}>
          I’ll fill it in myself
        </Button>
      )}
    </section>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import { clsx } from '../../utils/clsx'

/**
 * Address field with map-backed suggestions.
 *
 * Picking a suggestion sets the address **and** its coordinates in one action.
 * That is the point: the app finds venues by radius search, so an address
 * without a point is a venue nobody can find. Making the two arrive together
 * removes the step a partner was most likely to skip.
 *
 * Free typing still works — a partner whose address is not in OpenStreetMap
 * (common enough for new developments and informal addresses in SA) must not be
 * blocked from entering it. They just have to drop the map pin themselves, and
 * the map warns when no point is set.
 *
 * ACCESSIBILITY: this is the ARIA combobox pattern, not a div with a click
 * handler. Arrow keys move through options, Enter selects, Escape closes, and
 * `aria-activedescendant` keeps focus on the input so a screen reader announces
 * the highlighted option. A mouse-only autocomplete would have undone the
 * keyboard work done in the accessibility pass.
 *
 * NETWORK: suggestions come from Nominatim, OpenStreetMap's free geocoder. No
 * API key. Their usage policy asks for at most one request per second, which
 * the 500ms debounce plus typing latency respects — do not lower it, and do not
 * fire per keystroke. Results are restricted to South Africa.
 */
const DEBOUNCE_MS = 500

export default function AddressAutocomplete({ value, onChange, error }) {
  const [query, setQuery] = useState(value || '')
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const listId = useId()
  const boxRef = useRef(null)
  const skipNextLookup = useRef(false)

  // Keep in step if the parent resets the form (e.g. "add another venue").
  useEffect(() => {
    setQuery((q) => (value !== undefined && value !== q ? value || '' : q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    // Selecting an option writes the full address back — don't immediately
    // search for what we just chose.
    if (skipNextLookup.current) {
      skipNextLookup.current = false
      return
    }
    const q = query.trim()
    if (q.length < 4) {
      setOptions([])
      setFailed(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setFailed(false)
      try {
        const url =
          'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5' +
          '&countrycodes=za&q=' +
          encodeURIComponent(q)
        const results = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        }).then((r) => {
          if (!r.ok) throw new Error(String(r.status))
          return r.json()
        })
        setOptions(results)
        setOpen(results.length > 0)
        setActive(-1)
      } catch (err) {
        if (err.name !== 'AbortError') {
          // A geocoder outage must not stop someone listing their venue.
          setFailed(true)
          setOptions([])
        }
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // Close when focus or a click leaves the component.
  useEffect(() => {
    const onDocDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [])

  const choose = (option) => {
    skipNextLookup.current = true
    setQuery(option.display_name)
    setOpen(false)
    setActive(-1)
    onChange({
      address: option.display_name,
      latitude: Number(Number(option.lat).toFixed(6)),
      longitude: Number(Number(option.lon).toFixed(6)),
    })
  }

  const onKeyDown = (e) => {
    if (!open || options.length === 0) {
      if (e.key === 'ArrowDown' && options.length) setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (active >= 0) {
        e.preventDefault()
        choose(options[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label="Address"
        autoComplete="off"
        placeholder="Start typing your venue address"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          // Keep the typed text on the venue even if no suggestion is picked.
          onChange({ address: e.target.value })
        }}
        onKeyDown={onKeyDown}
        onFocus={() => options.length && setOpen(true)}
        className={clsx(
          'block w-full rounded-full border-2 bg-white py-2.5 pr-11 pl-5 text-sm text-ink-900',
          'placeholder:text-ink-500 focus:border-brand-edge focus:outline-none',
          error ? 'border-red-700' : 'border-field',
        )}
      />

      <span className="pointer-events-none absolute inset-y-0 right-4 grid place-items-center text-ink-500">
        {loading ? (
          <span
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <svg viewBox="0 0 20 20" className="size-4 fill-none stroke-current stroke-[1.75]">
            <path d="M10 18s6-5.2 6-9.4A6 6 0 004 8.6C4 12.8 10 18 10 18z" strokeLinejoin="round" />
            <circle cx="10" cy="8.5" r="2.25" />
          </svg>
        )}
      </span>

      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border-2 border-field bg-white py-1 shadow-lg"
        >
          {options.map((o, i) => (
            <li
              key={o.place_id ?? `${o.lat},${o.lon}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
            >
              <button
                type="button"
                // mousedown would blur the input before the click registers.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={clsx(
                  'block w-full px-5 py-2 text-left text-sm',
                  i === active ? 'bg-brand-50 text-ink-900' : 'text-ink-700',
                )}
              >
                {o.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* A geocoder outage is not the partner's problem to solve — say what to
          do instead rather than leaving an input that silently does nothing. */}
      {failed && (
        <p className="mt-1.5 px-2 text-xs text-ink-500">
          Address suggestions are unavailable right now. Type the address and drop the pin on the
          map below.
        </p>
      )}
    </div>
  )
}

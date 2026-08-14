import { useEffect, useId, useRef, useState } from 'react'
import { clsx } from '../../utils/clsx'
import DefaultChip, { ChipRow } from './DefaultChip'
import { CHIP_COPY, SOURCE } from '../../services/smartDefaults'
import { newSessionToken, resolveSuggestion, suggestAddresses } from '../../services/addressSuggest'

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
 * NETWORK: **Google Places when a Maps key is configured, Nominatim when it is
 * not** — see `services/addressSuggest.js`, which normalises both to one shape
 * so nothing below this line knows which answered. Results are restricted to
 * South Africa either way.
 *
 * The 500ms debounce is not tuning. Nominatim's usage policy asks for at most
 * one request per second, and Google bills per request. Do not lower it, and do
 * not fire per keystroke.
 *
 * ⚠️ A GOOGLE SUGGESTION HAS NO COORDINATES. Predictions carry a description
 * and a place id; the location is a second call, made on PICK. That is why
 * `choose` is async and why it must not write the address before the point
 * arrives — an address saved without a point is a venue with a plausible-looking
 * listing that no radius search will ever return.
 */
const DEBOUNCE_MS = 500

export default function AddressAutocomplete({ value, onChange, error, near }) {
  const [query, setQuery] = useState(value || '')
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const [confirmed, setConfirmed] = useState(false)
  const [noticeDismissed, setNoticeDismissed] = useState(false)

  const listId = useId()
  const chipId = useId()
  const boxRef = useRef(null)
  const skipNextLookup = useRef(false)
  /* Ties this burst of keystrokes to the pick that ends it, so the pair bills
     as one session rather than as N searches. Renewed after every pick. */
  const session = useRef(newSessionToken())

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

      /* LOCATION BIAS (spec §4). Prefers nearby results without excluding
         anything — a partner listing a venue in another city must still find
         it. Applied only while `near.prompt` is true: once they are reading the
         list, a late fix must not reorder it under them (§5). */
      const results = await suggestAddresses(q, {
        near,
        sessionToken: session.current,
        signal: controller.signal,
      })
      setLoading(false)

      /* null = could not ask. [] = asked, nothing matched. Rendering those the
         same way is the mistake this codebase keeps finding. */
      if (results === null) {
        setFailed(true)
        setOptions([])
        return
      }
      setOptions(results)
      setOpen(results.length > 0)
      setActive(-1)
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

  const choose = async (option) => {
    skipNextLookup.current = true
    setQuery(option.label)
    setOpen(false)
    setActive(-1)
    setConfirmed(true)
    setNoticeDismissed(false)

    /**
     * The address goes in immediately; the point may take a second call.
     *
     * A Google prediction carries no coordinates. Writing the address now and
     * the point when it lands keeps the field responsive, and the map fills in
     * a beat later — which is what already happens on a slow geocode.
     *
     * If the point never arrives we still keep the address: a venue with an
     * address and no pin is fixable by dragging the map, and the map says so
     * loudly. A venue with neither is a partner starting over.
     */
    onChange({ address: option.label })

    const located = await resolveSuggestion(option)
    /* Renew the session: this pick closed the previous one. */
    session.current = newSessionToken()
    if (!located) return

    onChange({
      address: located.address || option.label,
      ...(Number.isFinite(located.latitude) && Number.isFinite(located.longitude)
        ? { latitude: located.latitude, longitude: located.longitude }
        : {}),
    })
    setQuery(located.address || option.label)
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
          setConfirmed(false)
          near?.markInteracted?.()
          // Keep the typed text on the venue even if no suggestion is picked.
          onChange({ address: e.target.value })
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          near?.markInteracted?.()
          if (options.length) setOpen(true)
        }}
        aria-describedby={confirmed && !noticeDismissed ? chipId : undefined}
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
          {/* §8 — say WHY these results and not others. Without it, a list
              silently sorted by the partner's location is just a list that
              looks oddly local. `aria-hidden` because it is context for the
              options, not an option itself; a listbox child with no option role
              confuses the count a screen reader announces. */}
          {near?.coords && near.prompt && (
            <li aria-hidden="true" className="px-5 py-1.5 text-xs font-semibold text-[#1c7a45]">
              Showing places near you first
            </li>
          )}
          {options.map((o, i) => (
            <li
              key={o.id}
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
                {o.label}
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

      {/* CONFIRMATION, NOT A DEFAULT (spec §6). The partner chose this address
          themselves, so this chip reports what happened as a consequence — the
          pin moved — rather than offering a value we guessed.

          Dismissing it therefore removes THE NOTICE ONLY. The address text and
          the pin both stay exactly where they are. Clearing work the partner
          just did would be an obvious betrayal of the control the ✕ appears to
          offer, and is the one place in this feature where ✕ must not mean
          "undo". */}
      <ChipRow>
        {confirmed && !noticeDismissed && (
          <DefaultChip
            id={chipId}
            tone="location"
            onDismiss={() => setNoticeDismissed(true)}
            dismissLabel="Hide the pin notice"
          >
            {CHIP_COPY[SOURCE.LOCATION]}
          </DefaultChip>
        )}
      </ChipRow>
    </div>
  )
}

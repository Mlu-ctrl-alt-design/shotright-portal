import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Input } from '../ui'
import ProBadge from '../paywall/ProBadge'
import LockRow from '../paywall/LockRow'
import { clsx } from '../../utils/clsx'
import { getPlaceDetails, PLACE_TAKEN, searchPlaces } from '../../services/places'
import { importFromUrl, SOURCE } from '../../services/venueSources'

/**
 * "Start with your existing listing" — the first screen of adding a venue.
 *
 * A restaurant that has been trading for six years is already on Google, has a
 * Facebook page, and has a website with its hours on it. Asking that owner to
 * retype all of it is asking them to prove they are serious, and the wizard's
 * own drop-off says a good number of them will not.
 *
 * FOUR ROUTES, and only the ones this bench can actually serve are rendered —
 * see `venueSources.js` for why that is not negotiable. `sources` is passed in
 * rather than probed here so the parent can decide whether this screen is worth
 * showing AT ALL before it renders anything.
 *
 * WHAT IS PRO AND WHAT IS NOT. The single-venue routes are one entitlement and
 * the spreadsheet is another, checked separately, because they are sold as
 * separate lines on the plan and the bench stores them as separate rows. A
 * locked route still shows its tab: seeing that the spreadsheet import exists
 * is most of the reason anybody would pay for it, and a tab row that changes
 * shape with your plan makes the feature impossible to describe to support.
 */
const DEBOUNCE_MS = 400

const ROUTES = [
  { key: SOURCE.GOOGLE, label: 'Google listing' },
  { key: SOURCE.SOCIAL, label: 'Facebook or Instagram' },
  { key: SOURCE.WEBSITE, label: 'Your website' },
  { key: SOURCE.BULK, label: 'Several venues' },
]

function BoltIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="size-5 shrink-0 fill-none stroke-brand-ink stroke-[1.75]"
    >
      <path d="M11 2 4.5 11H9l-.5 7L15.5 9H11l.5-7Z" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 fill-none stroke-current stroke-[1.75]">
      <circle cx="9" cy="9" r="6" />
      <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
    </svg>
  )
}

export default function ImportPanel({
  sources,
  importLocked,
  bulkLocked,
  onUnlock,
  onImported,
}) {
  const available = ROUTES.filter((r) => sources?.[r.key])
  const [route, setRoute] = useState(available[0]?.key || SOURCE.GOOGLE)

  if (!available.length) return null

  return (
    <section
      aria-labelledby="import-heading"
      className="rounded-3xl border border-brand-500 bg-brand-50 p-7"
    >
      <div className="flex items-center gap-2.5">
        <BoltIcon />
        <h2 id="import-heading" className="text-base font-bold text-ink-900">
          Import your venue
        </h2>
        <ProBadge />
      </div>

      {available.length > 1 && (
        <div
          role="tablist"
          aria-label="Where to import from"
          className="mt-4 flex flex-wrap gap-2"
        >
          {available.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={route === r.key}
              onClick={() => setRoute(r.key)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-lg px-6 py-2.5 text-sm font-semibold transition',
                route === r.key
                  ? 'bg-brand-500 text-ink-900 shadow-sm'
                  : 'bg-white text-brand-ink ring-2 ring-field ring-inset hover:bg-brand-100',
              )}
            >
              {r.key === SOURCE.BULK && bulkLocked && (
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className="size-3.5 fill-none stroke-current stroke-[1.75]"
                >
                  <rect x="4" y="9" width="12" height="8" rx="2" />
                  <path d="M7 9V6.5a3 3 0 0 1 6 0V9" strokeLinecap="round" />
                </svg>
              )}
              {r.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        {route === SOURCE.GOOGLE &&
          (importLocked ? (
            <LockRow onUnlock={onUnlock}>
              Pull your name, address, hours and phone straight from Google. About 15 minutes
              saved per venue.
            </LockRow>
          ) : (
            <GoogleRoute onImported={onImported} />
          ))}

        {route === SOURCE.SOCIAL &&
          (importLocked ? (
            <LockRow onUnlock={onUnlock}>
              Read your details off your Facebook or Instagram page. Nothing is posted.
            </LockRow>
          ) : (
            <UrlRoute
              key="social"
              source={SOURCE.SOCIAL}
              id="social-url"
              label="Paste your page link"
              placeholder="facebook.com/yourvenue or instagram.com/yourvenue"
              hint="We read your details off the page. Nothing is posted."
              onImported={onImported}
            />
          ))}

        {route === SOURCE.WEBSITE &&
          (importLocked ? (
            <LockRow onUnlock={onUnlock}>
              Read your hours and contact details off your own website.
            </LockRow>
          ) : (
            <UrlRoute
              key="website"
              source={SOURCE.WEBSITE}
              id="website-url"
              label="Your website"
              placeholder="www.yourvenue.co.za"
              hint="We look for hours and contact details."
              onImported={onImported}
            />
          ))}

        {route === SOURCE.BULK &&
          (bulkLocked ? (
            <LockRow onUnlock={onUnlock}>
              Upload one spreadsheet and every row becomes a draft venue, filled in and waiting
              for photos. Nothing is submitted until you say so.
            </LockRow>
          ) : (
            <BulkRoute />
          ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ Google */

/**
 * Search Google, pick a listing.
 *
 * Searching is free and picking is not — the detail call is the billable one,
 * so it fires on a deliberate pick and never on a keystroke. Results are a
 * LIST and never pins on our map; both rules are `places.js`'s and both are
 * policy rather than preference.
 */
function GoogleRoute({ onImported }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState({ status: 'idle', results: [] })
  const [picking, setPicking] = useState(null)
  const [problem, setProblem] = useState(null)
  const latest = useRef(0)

  useEffect(() => {
    const text = query.trim()
    if (text.length < 3) {
      setState({ status: 'idle', results: [] })
      return undefined
    }
    const token = ++latest.current
    setState((s) => ({ ...s, status: 'searching' }))

    const timer = setTimeout(async () => {
      const result = await searchPlaces(text)
      // A slow answer to an old query must never overwrite a newer one.
      if (token !== latest.current) return
      setState({
        status: result.available ? 'done' : 'unavailable',
        results: result.results || [],
      })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query])

  const pick = async (hit) => {
    setPicking(hit.id)
    setProblem(null)
    const result = await getPlaceDetails(hit.id)
    setPicking(null)
    if (result.ok) return onImported(result.place, SOURCE.GOOGLE)
    setProblem(result.reason)
  }

  return (
    <div>
      <Input
        shape="field"
        label="Find your listing"
        id="place-query"
        placeholder="Type your venue name, e.g. The Yard Braai"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        trailing={<SearchIcon />}
      />

      {state.status === 'searching' && (
        <p role="status" className="mt-2 px-1 text-sm text-ink-500">
          Looking…
        </p>
      )}

      {state.status === 'done' && query.trim().length >= 3 && !state.results.length && (
        <p className="mt-2 px-1 text-sm text-ink-700">Nothing by that name. Try a shorter one.</p>
      )}

      {state.results.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {state.results.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => pick(hit)}
                disabled={hit.claimed || picking === hit.id}
                className={clsx(
                  'block w-full rounded-2xl border-2 border-ink-200 bg-white px-4 py-3 text-left transition',
                  hit.claimed
                    ? 'cursor-not-allowed opacity-55'
                    : 'hover:border-brand-edge disabled:opacity-60',
                )}
              >
                <span className="block text-sm font-bold text-ink-900">{hit.name}</span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  {hit.claimed ? 'Already claimed by another account' : hit.address}
                </span>
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
                Nothing has been filled in. Try another result, or type it in yourself — it works
                exactly the same.
              </p>
            </>
          )}
        </Alert>
      )}
    </div>
  )
}

/* ------------------------------------------- Facebook / Instagram / website */

/** One URL in, one venue's details out. Same component for both routes. */
function UrlRoute({ source, id, label, placeholder, hint, onImported }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('idle')
  const [problem, setProblem] = useState(null)

  const run = async (event) => {
    event.preventDefault()
    if (!url.trim()) return
    setStatus('reading')
    setProblem(null)
    const result = await importFromUrl(url, source)
    setStatus('idle')
    if (result.ok) return onImported(result.venue, source)
    setProblem(result.reason)
  }

  return (
    <form onSubmit={run}>
      <Input
        shape="field"
        type="url"
        inputMode="url"
        id={id}
        label={label}
        placeholder={placeholder}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        autoComplete="off"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button shape="field" size="sm" type="submit" loading={status === 'reading'}>
          Read it
        </Button>
        <p className="px-1 text-xs text-ink-500">{hint}</p>
      </div>

      {problem && (
        <Alert variant="warning" className="mt-3">
          {problem === 'not-found' ? (
            <>
              <p className="font-bold">We couldn’t read that page</p>
              <p className="mt-1">
                Check the link, or type your details in below — it works exactly the same.
              </p>
            </>
          ) : (
            <>
              <p className="font-bold">That didn’t work</p>
              <p className="mt-1">
                Nothing has been filled in. Type your details in below and carry on.
              </p>
            </>
          )}
        </Alert>
      )}
    </form>
  )
}

/* -------------------------------------------------------------------- bulk */

/**
 * Many venues from one spreadsheet.
 *
 * ⚠️ THE FILE IS HANDED TO THE EXISTING BULK IMPORT SCREEN, not read here.
 *
 * That screen's review step — every row, with what is wrong, before anything is
 * created — is the feature, for the reason its own file gives: a venue enters a
 * review queue, it is what customers see, and it cannot be reliably deleted
 * afterwards. Creating eleven venues and then explaining is not recoverable.
 *
 * So this is the design's dropzone wired to the flow that already does it
 * properly. The File rides on router state, which survives the navigation
 * because history state is structured-cloned and a File clones.
 */
function BulkRoute() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const hand = (file) => {
    if (!file) return
    navigate('/venues/import', { state: { file } })
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          hand(e.dataTransfer?.files?.[0])
        }}
        className={clsx(
          'rounded-lg border-2 border-dashed p-6 text-center transition',
          dragging ? 'border-brand-edge bg-brand-100' : 'border-field bg-white',
        )}
      >
        <p className="text-sm font-semibold text-ink-900">Drop your spreadsheet here</p>
        <p className="mt-1.5 text-xs text-ink-500">CSV or XLSX. One venue a row.</p>
        <div className="mt-3.5">
          <Button
            shape="field"
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          aria-label="Venue spreadsheet"
          accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => {
            hand(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <p className="mt-2.5 px-1 text-xs text-ink-500">
        Every row lands as a draft. You add photos and submit each one yourself.
      </p>
    </div>
  )
}

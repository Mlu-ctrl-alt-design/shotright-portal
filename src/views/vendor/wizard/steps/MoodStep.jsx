import { useMemo, useRef, useState } from 'react'
import { useMoods, usePopularMoods } from '../../../../hooks/useVendor'
import { resolveMood } from '../../../../services/vendor'
import { Button, Input, MoodPill, UploadProgress, Toast, Alert } from '../../../../components/ui'

/**
 * Wizard step 1 — moods.
 *
 * A partner types whatever fits their venue. Text matching the curated list
 * resolves onto it; anything genuinely new is filed for the Sho't Right team to
 * review and shown as PENDING, not as a normal mood — it is attached to the
 * venue immediately but does not reach customer search until approved, and
 * saying otherwise would promise traffic that is not coming yet.
 *
 * TWO BACKEND STATES, both handled:
 *
 *   resolve_mood deployed      new moods come back `suggested` and are added
 *                              with the pending treatment.
 *   resolve_mood absent        matching runs locally and new moods come back
 *                              `unmatched`. They are REFUSED here, at the point
 *                              of entry, with the closest real alternatives
 *                              offered.
 *
 * The refusal is not a lesser version of the feature, it is the honest one for
 * that state: `create_venue` rejects moods it does not know, so accepting one
 * would fail the whole submission four steps later. A partner used to type
 * "Masepa", carry on through four more steps, and only learn on the success
 * screen that it had been dropped.
 *
 * SMART DEFAULT: the moods other approved venues actually chose are offered up
 * front, before anything is typed. A partner facing an empty field has to guess
 * at a vocabulary they have never been shown; this turns recall into
 * recognition, and it is also what generates the usage data that makes the next
 * partner's list better.
 */
export default function MoodStep({ value, onChange }) {
  const { data: canonical = [] } = useMoods()
  const { data: popularAll = [] } = usePopularMoods()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [rejected, setRejected] = useState(null) // {label, near[]}
  const [toast, setToast] = useState(null)
  const [upload, setUpload] = useState(null)
  const [browsing, setBrowsing] = useState(false)
  const fileRef = useRef(null)

  const chosen = value.moods
  const alreadyChosen = (id) => chosen.some((m) => m.mood === id)

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    return canonical
      .filter((m) => m.mood_name.toLowerCase().includes(q) && !alreadyChosen(m.name))
      .slice(0, 6)
  }, [text, canonical, chosen])

  const available = canonical.filter((m) => !alreadyChosen(m.name))
  const popular = popularAll.filter((m) => !alreadyChosen(m.name))

  const add = async (raw) => {
    const input = (raw ?? text).trim()
    if (!input) return
    setBusy(true)
    setError(null)
    setRejected(null)
    try {
      const result = await resolveMood(input)

      // `unmatched` only happens when the suggestion endpoint is absent — see
      // the note at the top. Refuse rather than accept-and-drop. `near` is
      // whatever the resolver thought was closest; fall back to a loose
      // contains-search so the partner is never left at a dead end.
      if (result.status === 'unmatched') {
        const q = input.toLowerCase()
        const near = [
          ...(result.near ? [result.near.label] : []),
          ...canonical
            .filter((m) => m.mood_name.toLowerCase().includes(q.slice(0, 4)))
            .map((m) => m.mood_name),
        ]
        setRejected({ label: input, near: [...new Set(near)].slice(0, 4) })
        return
      }

      if (alreadyChosen(result.mood)) {
        setError(`"${result.label}" is already on this venue.`)
        return
      }

      onChange({ ...value, moods: [...chosen, result] })
      setText('')
      setToast(
        result.status === 'suggested'
          ? `"${result.label}" added and sent to the Sho't Right team to review.`
          : `"${result.label}" added.`,
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = (id) => onChange({ ...value, moods: chosen.filter((m) => m.mood !== id) })
  const clearAll = () => onChange({ ...value, moods: [] })

  /**
   * Bulk import. Same rule as typing: only moods the app actually has are added,
   * and the rest are named back to the partner rather than vanishing.
   */
  const onFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setRejected(null)

    const raw = await file.text()
    const lines = raw
      .split(/[\r\n,]+/)
      .map((l) => l.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)

    if (!lines.length) {
      setError('That file had no moods in it.')
      event.target.value = ''
      return
    }

    const collected = [...chosen]
    const unmatched = []
    let pending = 0
    for (let i = 0; i < lines.length; i++) {
      setUpload({ fileName: file.name, percent: ((i + 1) / lines.length) * 100 })
      try {
        const result = await resolveMood(lines[i])
        if (result.status === 'unmatched') {
          unmatched.push(lines[i])
        } else if (!collected.some((m) => m.mood === result.mood)) {
          collected.push(result)
          if (result.status === 'suggested') pending += 1
        }
      } catch {
        unmatched.push(lines[i])
      }
    }

    const added = collected.length - chosen.length
    onChange({ ...value, moods: collected })
    setUpload(null)
    setToast(
      `${added} mood${added === 1 ? '' : 's'} added from "${file.name}"` +
        (pending ? `, ${pending} awaiting review.` : '.'),
    )
    if (unmatched.length) {
      setError(
        `${unmatched.length} mood${unmatched.length === 1 ? '' : 's'} in that file ` +
          `${unmatched.length === 1 ? 'is' : 'are'} not on the Sho't Right list and ` +
          `${unmatched.length === 1 ? 'was' : 'were'} skipped: ${unmatched.join(', ')}.`,
      )
    }
    event.target.value = ''
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-700">
        Here is where you determine the vibe or mood your customers will search for in order to find
        your business on our application. Type your own if none of these fit — we&rsquo;ll review it
        and add it to the list.
      </p>

      {/* Smart default, front-loaded. Shown only until the first mood is picked:
          after that it is competing with the partner's own choices for the same
          screen space, and the browse list below covers the same ground. */}
      {chosen.length === 0 && popular.length > 0 && (
        <div className="rounded-3xl bg-brand-50 p-4">
          <p className="text-xs font-bold tracking-wide text-ink-700 uppercase">
            Most used by venues on Sho&rsquo;t Right
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {popular.map((m) => (
              <button
                key={m.name}
                type="button"
                onClick={() => add(m.mood_name)}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink-900
                           ring-1 ring-inset ring-field transition hover:bg-brand-100"
              >
                {m.mood_name}
                {m.venue_count > 0 && (
                  <span className="ml-1.5 font-normal text-ink-500">{m.venue_count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* The suggestion list is anchored to the WHOLE ROW, not to the input.
          On a phone the row wraps, so anchoring it to the input dropped it
          straight on top of the "Add +" button underneath — the button was
          visible, looked enabled, and swallowed every tap. On desktop the row
          and the input share a bottom edge, so this changes nothing there. */}
      <div className="relative flex flex-wrap items-start gap-4">
        <div className="min-w-64 flex-1">
          <Input
            aria-label="Mood"
            placeholder="Please add moods, vibes to your restaurant"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setRejected(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
        </div>

        <Button onClick={() => add()} loading={busy} className="shrink-0">
          Add +
        </Button>

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="ml-auto shrink-0 py-2.5 text-sm font-bold tracking-wide text-brand-ink uppercase hover:text-brand-900"
        >
          Upload Excel
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.xlsx"
          onChange={onFile}
          className="hidden"
        />

        {matches.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-2xl border-2 border-field bg-white py-1 shadow-lg">
            {matches.map((m) => (
              <li key={m.name}>
                <button
                  type="button"
                  onClick={() => add(m.mood_name)}
                  className="block w-full px-5 py-2 text-left text-sm hover:bg-brand-50"
                >
                  {m.mood_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {upload && <UploadProgress fileName={upload.fileName} percent={upload.percent} />}
      {error && <Alert variant="danger">{error}</Alert>}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* An unmatched mood is refused here, with a way forward — never accepted
          and then quietly dropped four steps later. */}
      {rejected && (
        <Alert variant="warning">
          <p className="font-bold">
            Sho&rsquo;t Right doesn&rsquo;t have &ldquo;{rejected.label}&rdquo; yet
          </p>
          <p className="mt-1">
            Customers search using a set list of moods, so only those can go on your venue.
            {rejected.near.length > 0 && ' Closest matches:'}
          </p>
          {rejected.near.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {rejected.near.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => add(n)}
                  className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-ink ring-2 ring-inset ring-field hover:bg-brand-50"
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2">
            Nothing fits?{' '}
            <button
              type="button"
              onClick={() => setBrowsing(true)}
              className="font-semibold text-brand-ink underline"
            >
              See everything available
            </button>{' '}
            — or ask the Sho&rsquo;t Right team to add it.
          </p>
        </Alert>
      )}

      <div className="min-h-64 rounded-3xl border-2 border-field p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-700">
            If you&rsquo;re unhappy with a mood, just select and delete it.
          </p>
          <button
            type="button"
            onClick={() => setBrowsing((v) => !v)}
            aria-expanded={browsing}
            className="text-sm font-semibold text-brand-ink underline"
          >
            {browsing ? 'Hide the full list' : `Browse all ${canonical.length} moods`}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {chosen.map((m) => (
            <MoodPill key={m.mood} variant={m.status} onRemove={() => remove(m.mood)}>
              {m.label}
            </MoodPill>
          ))}
        </div>

        {/* Explain the pending state where it is visible, not on the success
            screen. A partner who sees "pending" needs to know now whether their
            venue is broken — it is not — and roughly what happens next. */}
        {chosen.some((m) => m.status === 'suggested') && (
          <p className="mt-3 text-xs text-ink-700">
            Moods marked <span className="font-semibold">pending</span> are new to Sho&rsquo;t
            Right. They stay on your venue and we&rsquo;ll review them — once approved, customers
            searching that vibe will find you. Everything else about your venue goes live as normal.
          </p>
        )}

        {/* Partners cannot guess a vocabulary they have never been shown. */}
        {browsing && (
          <div className="mt-5 border-t border-brand-200 pt-4">
            <p className="text-xs font-bold tracking-wide text-ink-500 uppercase">Tap to add</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {available.length === 0 && (
                <p className="text-sm text-ink-500">You&rsquo;ve added all of them.</p>
              )}
              {available.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  onClick={() => add(m.mood_name)}
                  className="rounded-full bg-white px-3 py-1 text-xs font-medium text-ink-900 ring-1 ring-inset ring-field transition hover:bg-brand-50"
                >
                  {m.mood_name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {chosen.length > 0 && (
        <Button variant="ghost" onClick={clearAll} className="px-0">
          Clear all moods
        </Button>
      )}
    </div>
  )
}

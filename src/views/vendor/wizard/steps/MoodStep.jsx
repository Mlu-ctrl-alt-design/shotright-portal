import { useMemo, useRef, useState } from 'react'
import { useMoods } from '../../../../hooks/useVendor'
import { resolveMood } from '../../../../services/vendor'
import { Button, Input, MoodPill, UploadProgress, Toast, Alert } from '../../../../components/ui'

/**
 * Wizard step 1 — moods.
 *
 * C1 was decided as "partners type their own moods, and anything new becomes a
 * suggestion for staff to merge". The live backend does not support that:
 * `create_venue` rejects any mood not already on the curated list, and there is
 * no endpoint to file a suggestion. See docs/BACKEND-INTEGRATION.md §2.
 *
 * So this step tells the truth AT THE POINT OF ENTRY rather than at submit.
 * A partner used to type "Masepa", carry on through four more steps, and only
 * discover on the success screen that it had been dropped. An unmatched mood is
 * now refused immediately, with the closest real alternatives offered.
 *
 * Free typing is kept — it is the fastest way in for someone who knows what
 * they want, and it is what the designs show. What changed is that it can no
 * longer produce something that looks added but is not. The full list is also
 * browsable, because a partner cannot guess at a vocabulary they have never
 * been shown.
 *
 * When the backend gains mood suggestions, restore the `suggested` branch in
 * `add()` and the outlined `MoodPill variant="suggested"` treatment — both are
 * still supported by the components.
 */
export default function MoodStep({ value, onChange }) {
  const { data: canonical = [] } = useMoods()
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

  const add = async (raw) => {
    const input = (raw ?? text).trim()
    if (!input) return
    setBusy(true)
    setError(null)
    setRejected(null)
    try {
      const result = await resolveMood(input)

      if (result.status !== 'canonical') {
        // Refuse rather than accept-and-drop. `near` is whatever the resolver
        // thought was closest; fall back to a loose contains-search so the
        // partner is never left at a dead end with no next move.
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
      setToast(`"${result.label}" added.`)
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
    for (let i = 0; i < lines.length; i++) {
      setUpload({ fileName: file.name, percent: ((i + 1) / lines.length) * 100 })
      try {
        const result = await resolveMood(lines[i])
        if (result.status !== 'canonical') unmatched.push(lines[i])
        else if (!collected.some((m) => m.mood === result.mood)) collected.push(result)
      } catch {
        unmatched.push(lines[i])
      }
    }

    const added = collected.length - chosen.length
    onChange({ ...value, moods: collected })
    setUpload(null)
    setToast(`${added} mood${added === 1 ? '' : 's'} added from "${file.name}".`)
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
        your business on our application.
      </p>

      <div className="flex flex-wrap items-start gap-4">
        <div className="relative min-w-64 flex-1">
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
          {matches.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-2xl border-2 border-brand-edge bg-white py-1 shadow-lg">
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
                  className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-ink ring-2 ring-inset ring-brand-edge hover:bg-brand-50"
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

      <div className="min-h-64 rounded-3xl border-2 border-brand-edge p-5">
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
                  className="rounded-full bg-white px-3 py-1 text-xs font-medium text-ink-900 ring-1 ring-inset ring-brand-edge transition hover:bg-brand-50"
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

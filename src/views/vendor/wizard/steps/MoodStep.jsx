import { useMemo, useRef, useState } from 'react'
import { useMoods } from '../../../../hooks/useVendor'
import { resolveMood } from '../../../../services/vendor'
import { Button, Input, MoodPill, UploadProgress, Toast, Alert } from '../../../../components/ui'

/**
 * Wizard step 1 — moods.
 *
 * Conflict C1 resolved: partners type whatever they like, and the backend
 * either resolves the text onto a canonical Mood or files a Mood Suggestion for
 * staff to merge. Two things follow from that, and both are additions to the
 * design rather than departures from it:
 *
 *  1. A typeahead over the canonical list. This is what actually keeps search
 *     clean — nudging "boys night" onto "Boys Night Out" before it is ever
 *     submitted beats merging duplicates afterwards.
 *  2. Pills are visually distinct once added. A canonical mood is live
 *     immediately; a suggestion is not searchable until staff approve it, and a
 *     partner who cannot see that difference will assume their custom mood is
 *     already working.
 */
export default function MoodStep({ value, onChange }) {
  const { data: canonical = [] } = useMoods()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [upload, setUpload] = useState(null)
  const fileRef = useRef(null)

  const chosen = value.moods
  const alreadyChosen = (id) => chosen.some((m) => m.mood === id)

  // Canonical suggestions for what has been typed so far, minus anything
  // already on the venue.
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    return canonical
      .filter((m) => m.mood_name.toLowerCase().includes(q) && !alreadyChosen(m.name))
      .slice(0, 6)
  }, [text, canonical, chosen])

  const add = async (raw) => {
    const input = (raw ?? text).trim()
    if (!input) return
    setBusy(true)
    setError(null)
    try {
      const result = await resolveMood(input)
      if (alreadyChosen(result.mood)) {
        setError(`"${result.label}" is already on this venue.`)
        return
      }
      onChange({ ...value, moods: [...chosen, result] })
      setText('')
      setToast(
        result.status === 'canonical'
          ? `"${result.label}" added.`
          : `"${result.label}" added — our team will review it before it goes live.`,
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
   * Excel import. Real .xlsx parsing belongs on the bench (PRD §7.3) so the
   * importer and this form resolve moods identically — here we read one mood
   * per line from a text/CSV file and push each through the same endpoint.
   */
  const onFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)

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
    for (let i = 0; i < lines.length; i++) {
      setUpload({ fileName: file.name, percent: ((i + 1) / lines.length) * 100 })
      try {
        const result = await resolveMood(lines[i])
        if (!collected.some((m) => m.mood === result.mood)) collected.push(result)
      } catch {
        // One unparseable row should not abandon the rest of the file.
      }
    }

    onChange({ ...value, moods: collected })
    setUpload(null)
    setToast(`${lines.length} moods read from "${file.name}".`)
    event.target.value = ''
  }

  const pendingCount = chosen.filter((m) => m.status === 'suggested').length

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
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          {matches.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-2xl border-2 border-brand-500 bg-white py-1 shadow-lg">
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
          className="ml-auto shrink-0 py-2.5 text-sm font-bold tracking-wide text-brand-600 uppercase hover:text-brand-700"
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

      <div className="min-h-64 rounded-3xl border-2 border-brand-500 p-5">
        <p className="text-sm text-ink-700">
          If you&rsquo;re unhappy with a mood, just select and delete it.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {chosen.map((m) => (
            <MoodPill key={m.mood} variant={m.status} onRemove={() => remove(m.mood)}>
              {m.label}
            </MoodPill>
          ))}
        </div>

        {pendingCount > 0 && (
          <p className="mt-5 text-xs text-ink-500">
            {pendingCount} outlined {pendingCount === 1 ? 'mood is' : 'moods are'} new to Sho&rsquo;t
            Right. Your venue is listed under them once our team has reviewed them — everything else
            goes live straight away.
          </p>
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

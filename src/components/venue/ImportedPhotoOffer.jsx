import { useState } from 'react'
import { Alert, Button } from '../ui'
import { importPhotos } from '../../services/venueSources'

/**
 * "Photos from your page" — the images the importer found on the partner's
 * own website or social page, offered rather than taken.
 *
 * A photo on a web page belongs to whoever took it. The partner is the only
 * one who can say that was them (or someone they paid), so nothing is fetched
 * until they have ticked the ones they want AND ticked that they are theirs to
 * use. Every image starts ticked — they came from the partner's own page — but
 * the confirmation starts empty, and the button waits for it.
 */
export default function ImportedPhotoOffer({ suggestions, room, onAdded, onDone }) {
  const [chosen, setChosen] = useState(() => new Set(suggestions.slice(0, room)))
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState('idle')

  const picked = suggestions.filter((url) => chosen.has(url))
  const toggle = (url) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else if (next.size < room) next.add(url)
      return next
    })

  const add = async () => {
    setStatus('saving')
    try {
      const saved = await importPhotos(picked)
      onAdded(saved)
      if (saved.length < picked.length) setStatus('partial')
      else onDone()
    } catch {
      setStatus('failed')
    }
  }

  return (
    <fieldset aria-label="Photos from your page" className="rounded-3xl bg-white p-5 ring-1 ring-ink-200">
      <legend className="sr-only">Photos from your page</legend>
      <p className="text-sm font-bold text-ink-900">Photos from your page</p>
      <p className="mt-1 text-xs text-ink-500">
        We found these where we read your details. Untick any you don’t want.
      </p>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {suggestions.map((url, i) => (
          <li key={url}>
            <label className="block cursor-pointer">
              <img src={url} alt="" className="aspect-square w-full rounded-2xl object-cover" loading="lazy" />
              <span className="mt-1.5 flex items-center gap-2 text-xs text-ink-700">
                <input
                  type="checkbox"
                  checked={chosen.has(url)}
                  onChange={() => toggle(url)}
                  aria-label={`Use this photo ${i + 1}`}
                />
                Use this photo
              </span>
            </label>
          </li>
        ))}
      </ul>

      <label className="mt-4 flex items-start gap-2 text-sm text-ink-900">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
        <span>These photos are mine, or my venue’s, to use.</span>
      </label>

      {status === 'partial' && (
        <Alert variant="warning" className="mt-3">
          Some photos couldn’t be fetched from your page. Upload those yourself below.
        </Alert>
      )}
      {status === 'failed' && (
        <Alert variant="danger" className="mt-3">
          We couldn’t add those photos just now. Try again, or upload them below.
        </Alert>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          shape="field"
          size="sm"
          onClick={add}
          disabled={!confirmed || picked.length === 0}
          loading={status === 'saving'}
        >
          Add {picked.length} {picked.length === 1 ? 'photo' : 'photos'}
        </Button>
        <Button shape="field" size="sm" variant="ghost" onClick={onDone}>
          No thanks
        </Button>
      </div>
    </fieldset>
  )
}

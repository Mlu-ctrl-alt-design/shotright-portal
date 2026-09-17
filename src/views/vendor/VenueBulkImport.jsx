import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useMoods } from '../../hooks/useVendor'
import { useFeature } from '../../hooks/usePlan'
import { FEATURE } from '../../services/plan'
import { Alert, Button, Card } from '../../components/ui'
import ProBadge from '../../components/paywall/ProBadge'
import UpgradeDialog from '../../components/paywall/UpgradeDialog'
import {
  VENUE_TEMPLATE_HEADERS,
  MOOD_SEPARATOR,
  buildVenueTemplateCsv,
  parseVenueFile,
} from '../../utils/venueImport'
import { importVenueDrafts } from '../../services/venueImport'

/**
 * Many venues from one spreadsheet.
 *
 * ⚠️ THE REVIEW STEP IS THE FEATURE. Nothing is sent until the partner has seen
 * what we understood, because a venue is not a menu item: it enters a review
 * queue, it is what customers see, and it cannot be reliably deleted afterwards
 * — `frappe.client.delete` is not a permission the Vendor role can be counted
 * on to have. Creating eleven venues and then explaining is not recoverable in
 * the way "remove that dish" is.
 *
 * So the shape is: read the file, show every row with what is wrong, create
 * only the rows that are ready, and report what happened line by line.
 */
export default function VenueBulkImport() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { data: moods = [] } = useMoods()
  const fileInput = useRef(null)

  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [paywall, setPaywall] = useState(false)

  /**
   * ⚠️ PRO, as of 17 Sep — and gated HERE as well as on the add-venue screen.
   *
   * The add screen's "Several venues" route shows the lock, but this route has
   * its own URL, is linked from the venues list, and is in partners' history.
   * A paywall with a hole in it is not a paywall; worse, it is one that punishes
   * the partners who followed the UI and rewards the ones who kept a bookmark.
   *
   * `locked` is false while the answer is in flight and false whenever the
   * bench cannot be asked — see `usePlan.js` and `plan.js`. Nobody is ever shown
   * a lock this portal is not sure about.
   */
  const bulk = useFeature(FEATURE.BULK_IMPORT)

  const read = async (file) => {
    if (!file) return
    setError(null)
    setResult(null)
    setParsed(null)
    setFileName(file.name)
    try {
      setParsed(await parseVenueFile(file, { moods }))
    } catch (err) {
      setParsed(null)
      setError(err.message)
    }
  }

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // so the same file can be re-picked after a fix
    await read(file)
  }

  /**
   * A file handed over by the add-venue screen's dropzone.
   *
   * It rides on router state, which survives the navigation because history
   * state is structured-cloned and a File clones. The point of routing it here
   * rather than reading it there is the review step below — nothing is created
   * until the partner has seen what we understood, and that is the feature.
   *
   * Waits for the mood list, because parsing checks every mood against it and a
   * file read too early reports every mood as unknown. Cleared from history
   * afterwards so a refresh does not silently re-read a file they have moved on
   * from.
   */
  const handed = location.state?.file
  useEffect(() => {
    if (!handed || !moods.length || bulk.locked) return
    read(handed)
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handed, moods.length, bulk.locked])

  const run = async () => {
    if (!parsed?.ready.length) return
    setProgress({ done: 0, total: parsed.ready.length, current: null })
    const outcome = await importVenueDrafts(parsed.ready, { onProgress: setProgress })
    setProgress(null)
    setResult(outcome)
    setParsed(null)
    /* The venue list is stale the moment the first one lands. */
    qc.invalidateQueries({ queryKey: ['venues'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const download = () => {
    const blob = new Blob([buildVenueTemplateCsv()], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shot-right-venues-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold text-ink-900">Add venues from a spreadsheet</h1>
            <ProBadge />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            One row per venue. They arrive as drafts, so you can add photos before anything goes
            for review.
          </p>
        </div>
        <Link to="/venues">
          <Button variant="ghost">Back to venues</Button>
        </Link>
      </div>

      {/* ----------------------------------------------------------- locked */}
      {bulk.locked && (
        <Card title="This one’s on Pro">
          <p className="text-sm text-ink-700">
            Upload one spreadsheet and every row becomes a draft venue, filled in and waiting for
            photos. Nothing is submitted until you say so.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button shape="field" onClick={() => setPaywall(true)}>
              See what Pro includes
            </Button>
            {/* The way through without paying, said plainly. A paywall that
                leaves someone with nowhere to go converts nobody and loses the
                venue as well as the subscription. */}
            <Link
              to="/venues/new"
              className="text-sm font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900"
            >
              Add one venue instead
            </Link>
          </div>
        </Card>
      )}

      <UpgradeDialog open={paywall} onClose={() => setPaywall(false)} />

      {error && (
        <Alert variant="danger">
          <p className="font-bold">We couldn’t read that file</p>
          <p className="mt-1">{error}</p>
        </Alert>
      )}

      {/* ---------------------------------------------------------- results */}
      {result && (
        <Card title="What happened">
          <p className="text-sm text-ink-900">
            <span className="font-bold">
              {result.created.length} {result.created.length === 1 ? 'draft' : 'drafts'} ready
            </span>
            {result.failed.length > 0 && `, ${result.failed.length} refused`}. Nothing has gone
            for review yet.
          </p>

          {result.created.length > 0 && (
            <ul className="mt-4 divide-y divide-gray-200">
              {result.created.map((row) => (
                <li key={row.lineNumber} className="flex flex-wrap items-baseline gap-x-3 py-2">
                  <span className="text-xs tabular-nums text-ink-500">Line {row.lineNumber}</span>
                  {row.id ? (
                    /* Straight into the wizard on the step a photograph belongs
                       to, with their own nine fields already filled in. */
                    <Link
                      to={`/venues/new?draft=${encodeURIComponent(row.id)}`}
                      className="text-sm font-medium text-brand-ink underline"
                    >
                      {row.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-ink-900">{row.name}</span>
                  )}
                  {/* `createVenue`'s own warnings, said here rather than
                      swallowed — a venue with no map location is invisible to
                      customers whether it arrived one at a time or in a file. */}
                  {row.notes.map((n) => (
                    <span key={n} className="w-full text-xs text-ink-500">
                      {n}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}

          {result.failed.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-bold text-ink-900">Not added</h3>
              <ul className="mt-2 divide-y divide-gray-200">
                {result.failed.map((row) => (
                  <li key={row.lineNumber} className="py-2 text-sm">
                    <span className="text-xs tabular-nums text-ink-500">Line {row.lineNumber}</span>{' '}
                    <span className="font-medium text-ink-900">{row.name}</span>
                    <p className="text-xs text-red-700">{row.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The point of drafts. Open one, add photographs, submit — through
              the flow that already requires a photo rather than around it. */}
          {result.created.length > 0 && (
            <Alert variant="info" className="mt-5">
              Open each one to add photos and send it for review. Nothing here is live, and
              nothing is waiting on our reviewers.
            </Alert>
          )}

          {/* ⚠️ `saveDraft` falls back to this browser's storage when the bench
              has no draft endpoint. Right for one draft; a different promise for
              eleven, and a partner told "they're saved" who opens their phone
              and finds nothing has been failed by us. */}
          {result.created.length > 0 && !result.portable && (
            <Alert variant="warning" className="mt-3">
              These are saved in this browser, not on your account yet — so finish them here, on
              this device, rather than on your phone.
            </Alert>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => navigate('/')}>See your drafts</Button>
            <Button variant="secondary" onClick={() => setResult(null)}>
              Upload another file
            </Button>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- picking */}
      {!bulk.locked && !parsed && !result && !progress && (
        <Card title="Your spreadsheet">
          <p className="text-sm text-ink-700">
            Start from the template. One row per venue, and separate moods with a semicolon.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Columns:{' '}
            <code className="rounded bg-gray-100 px-1 font-mono text-xs">
              {VENUE_TEMPLATE_HEADERS.join(', ')}
            </code>
. Excel or CSV.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={download}>
              Download the template
            </Button>
            <input
              ref={fileInput}
              type="file"
              aria-label="Venue spreadsheet"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFile}
              className="block min-w-56 flex-1 text-sm text-ink-700 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
          </div>
        </Card>
      )}

      {/* --------------------------------------------------------- progress */}
      {progress && (
        <Card title="Adding your venues">
          <p className="text-sm text-ink-900" role="status">
            {progress.done} of {progress.total} saved
            {progress.current ? ` — ${progress.current}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Leaving this page stops the ones that haven’t been saved yet. The ones already saved
            are safe.
          </p>
        </Card>
      )}

      {/* ----------------------------------------------------------- review */}
      {parsed && !progress && (
        <Card
          title={`${fileName} — ${parsed.rows.length} ${parsed.rows.length === 1 ? 'row' : 'rows'}`}
        >
          <p className="text-sm text-ink-900">
            <span className="font-bold">{parsed.ready.length} ready</span>
            {parsed.blocked.length > 0 && `, ${parsed.blocked.length} need a look`}. Nothing has
            been created yet.
          </p>

          <ul className="mt-4 divide-y divide-gray-200">
            {parsed.rows.map((row) => (
              <li key={row.lineNumber} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-xs tabular-nums text-ink-500">Line {row.lineNumber}</span>
                  <span className="text-sm font-medium text-ink-900">
                    {row.venue.venue_name || <span className="text-red-700">No name</span>}
                  </span>
                  {row.problems.length === 0 && (
                    <span className="text-xs font-semibold text-green-700">Ready</span>
                  )}
                </div>
                {row.problems.map((p) => (
                  <p key={p} className="mt-1 text-xs font-medium text-red-700">
                    {p}
                  </p>
                ))}
                {row.notes.map((n) => (
                  <p key={n} className="mt-1 text-xs text-ink-500">
                    {n}
                  </p>
                ))}
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={run} disabled={!parsed.ready.length}>
              {parsed.ready.length === 1
                ? 'Create 1 draft'
                : `Create ${parsed.ready.length} drafts`}
            </Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Upload a different file
            </Button>
          </div>
          {/* The file is not modified and nothing is created for a blocked row,
              so fixing the sheet and re-uploading is the whole recovery path. */}
          {parsed.blocked.length > 0 && (
            <p className="mt-3 text-xs text-ink-500">
              Fix the lines above in your spreadsheet and upload it again — the rows that are
              ready will still be here.
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            aria-label="Venue spreadsheet"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFile}
            className="hidden"
          />
        </Card>
      )}
    </div>
  )
}

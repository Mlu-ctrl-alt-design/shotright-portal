import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useMoods } from '../../hooks/useVendor'
import { Alert, Button, Card } from '../../components/ui'
import {
  VENUE_TEMPLATE_HEADERS,
  MOOD_SEPARATOR,
  buildVenueTemplateCsv,
  parseVenueFile,
} from '../../utils/venueImport'
import { importVenues } from '../../services/venueImport'

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
  const qc = useQueryClient()
  const { data: moods = [] } = useMoods()
  const fileInput = useRef(null)

  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)

  const onFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // so the same file can be re-picked after a fix
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

  const run = async () => {
    if (!parsed?.ready.length) return
    setProgress({ done: 0, total: parsed.ready.length, current: null })
    const outcome = await importVenues(parsed.ready, { onProgress: setProgress })
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
          <h1 className="text-2xl font-semibold text-ink-900">Add venues from a spreadsheet</h1>
          <p className="mt-1 text-sm text-ink-500">
            One row per venue. Nothing is created until you have seen what we read.
          </p>
        </div>
        <Link to="/venues">
          <Button variant="ghost">Back to venues</Button>
        </Link>
      </div>

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
              {result.created.length} {result.created.length === 1 ? 'venue' : 'venues'} added
            </span>
            {result.failed.length > 0 && `, ${result.failed.length} refused`}.
          </p>

          {result.created.length > 0 && (
            <ul className="mt-4 divide-y divide-gray-200">
              {result.created.map((row) => (
                <li key={row.lineNumber} className="flex flex-wrap items-baseline gap-x-3 py-2">
                  <span className="text-xs tabular-nums text-ink-500">Line {row.lineNumber}</span>
                  {row.id ? (
                    <Link
                      to={`/venues/${row.id}`}
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
                  {row.warnings.map((w) => (
                    <span key={w} className="w-full text-xs text-brand-800">
                      {w}
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

          {/* A venue with no photo cannot go live, and this path cannot carry
              one. Said once, plainly, with somewhere to go. */}
          {result.created.length > 0 && (
            <Alert variant="warning" className="mt-5">
              Each of these still needs at least one photo before it can go to our reviewers.
            </Alert>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={() => navigate('/venues')}>See your venues</Button>
            <Button variant="secondary" onClick={() => setResult(null)}>
              Upload another file
            </Button>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- picking */}
      {!parsed && !result && !progress && (
        <Card title="Your spreadsheet">
          <p className="text-sm text-ink-700">
            Start from the template. One row per venue, and separate moods with a semicolon.
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Columns:{' '}
            <code className="rounded bg-gray-100 px-1 font-mono text-xs">
              {VENUE_TEMPLATE_HEADERS.join(', ')}
            </code>
            . Save as CSV.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={download}>
              Download the template
            </Button>
            <input
              ref={fileInput}
              type="file"
              aria-label="Venue spreadsheet"
              accept=".csv,text/csv"
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
            {progress.done} of {progress.total} added
            {progress.current ? ` — ${progress.current}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Leaving this page stops the ones that haven’t been added yet. The ones already added
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
            <span className="font-bold">{parsed.ready.length} ready to add</span>
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
              {parsed.ready.length === 1 ? 'Add 1 venue' : `Add ${parsed.ready.length} venues`}
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
            accept=".csv,text/csv"
            onChange={onFile}
            className="hidden"
          />
        </Card>
      )}
    </div>
  )
}

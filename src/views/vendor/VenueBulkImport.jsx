import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFeature } from '../../hooks/usePlan'
import { FEATURE, isPaywalled } from '../../services/plan'
import { stateLabel, stateTone } from '../../services/workflowState'
import { Alert, Badge, Button, Card, UploadProgress } from '../../components/ui'
import ProBadge from '../../components/paywall/ProBadge'
import UpgradeDialog from '../../components/paywall/UpgradeDialog'
import {
  ACCEPTED_EXTENSIONS,
  blockerLabel,
  cancelVenueImport,
  getVenueImportStatus,
  getVenueImportTemplate,
  isFinished,
  partnerColumns,
  plainImportError,
  startVenueImport,
  templateCsv,
  uploadVenueFile,
  venueImportPolling,
} from '../../services/venueImport'

/**
 * Many venues from one spreadsheet — through the bench's importer.
 *
 * The file is uploaded, `start_venue_import` queues a background job, and this
 * screen watches it. Every venue lands in **Draft**: invisible to customers, in
 * no review queue, deletable. That is why there is no client-side review step
 * any more — the old one existed because the browser was creating listings
 * itself, one call per row, with nothing on the server checking the file.
 *
 * The running import's name lives in the URL (`?import=VI-…`), so a refresh,
 * a closed tab or a link sent to a colleague comes back to the same job.
 */
/* `.xls` is accepted by the picker on purpose, so the partner is told how to
   save it as .xlsx rather than finding the file greyed out. */
const ACCEPT =
  '.csv,text/csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export default function VenueBulkImport() {
  const [params, setParams] = useSearchParams()
  const importName = params.get('import')
  const [paywall, setPaywall] = useState(false)

  /**
   * ⚠️ PRO, as of 17 Sep — and gated HERE as well as on the add-venue screen.
   *
   * This route has its own URL, is linked from the venues list, and is in
   * partners' history. The bench refuses a locked caller on its own
   * (`FeatureLockedError`), so this lock is the courtesy, not the wall.
   *
   * `locked` is false while the answer is in flight and false whenever the
   * bench cannot be asked — see `usePlan.js`. Nobody is shown a lock this
   * portal is not sure about.
   */
  const bulk = useFeature(FEATURE.BULK_IMPORT)

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

      <UpgradeDialog open={paywall} onClose={() => setPaywall(false)} />

      {/* A job already started is shown whatever the lock says: the venues it
          wrote are the partner's, and hiding them behind a paywall would be
          hiding their own work. */}
      {importName ? (
        <ImportJob name={importName} onRestart={() => setParams({})} />
      ) : bulk.locked ? (
        <Card title="This one’s on Pro">
          <p className="text-sm text-ink-700">
            Upload one spreadsheet and every row becomes a draft venue, filled in and waiting for
            photos. Nothing is submitted until you say so.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button shape="field" onClick={() => setPaywall(true)}>
              See what Pro includes
            </Button>
            {/* The way through without paying, said plainly. */}
            <Link
              to="/venues/new"
              className="text-sm font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900"
            >
              Add one venue instead
            </Link>
          </div>
        </Card>
      ) : (
        <Picker
          onStarted={(name) => setParams({ import: name })}
          onPaywalled={() => setPaywall(true)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ picking */

const extensionOf = (name) => {
  const dot = String(name || '').lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

/** A reason we will not send this file, or null. Checked before uploading. */
const refusal = (file) => {
  const ext = extensionOf(file?.name)
  if (ext === '.xls') {
    return 'That’s the older .xls format, which we can’t read. In Excel, choose Save As → Excel Workbook (.xlsx) and upload that.'
  }
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return 'Upload an Excel workbook (.xlsx) or a CSV file.'
  }
  return null
}

function Picker({ onStarted, onPaywalled }) {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const fileInput = useRef(null)

  const [file, setFile] = useState(null)
  const [problem, setProblem] = useState(null)
  const [uploading, setUploading] = useState(null)

  const template = useQuery({
    queryKey: ['venueImportTemplate'],
    queryFn: getVenueImportTemplate,
    staleTime: Infinity,
  })

  const choose = (picked) => {
    if (!picked) return
    setProblem(null)
    const reason = refusal(picked)
    if (reason) {
      setFile(null)
      setProblem({ title: 'We can’t read that kind of file', message: reason })
      return
    }
    setFile(picked)
  }

  /**
   * A file handed over by the add-venue screen's dropzone, on router state. It
   * is SELECTED, not imported — the partner still presses the button. Cleared
   * from history so a refresh does not re-offer a file they have moved on from.
   */
  const handed = location.state?.file
  useEffect(() => {
    if (!handed) return
    choose(handed)
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handed])

  const start = async () => {
    if (!file) return
    setProblem(null)
    setUploading(0)
    try {
      const docname = await uploadVenueFile(file, setUploading)
      const job = await startVenueImport(docname)
      qc.setQueryData(['venueImport', job.name], job)
      onStarted(job.name)
    } catch (err) {
      setProblem(describeStartFailure(err))
      if (isPaywalled(err)) onPaywalled()
    } finally {
      setUploading(null)
    }
  }

  const download = () => {
    const blob = new Blob([templateCsv(template.data)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shot-right-venues-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const sheets = template.data?.sheets || []

  return (
    <>
      {problem && (
        <Alert variant={problem.tone || 'danger'}>
          <p className="font-bold">{problem.title}</p>
          <p className="mt-1">{problem.message}</p>
        </Alert>
      )}

      <Card title="Your spreadsheet">
        <p className="text-sm text-ink-700">
          Start from the template: one row per venue on a sheet called <strong>venues</strong>.
          {template.data?.max_venues ? ` Up to ${template.data.max_venues} venues a file.` : ''}{' '}
          Give each venue your own reference in <code className="font-mono">external_ref</code>{' '}
          and uploading the file again updates those venues instead of adding them twice.
        </p>

        {sheets.length > 0 && (
          <dl className="mt-4 space-y-3">
            {sheets.map((sheet) => (
              <div key={sheet.name}>
                <dt className="text-xs font-bold text-ink-900">
                  {sheet.name}
                  <span className="font-normal text-ink-500">
                    {sheet.required ? ' — required' : ' — optional, Excel only'}
                  </span>
                </dt>
                <dd className="mt-0.5 text-xs text-ink-500">
                  <code className="rounded bg-gray-100 px-1 font-mono text-xs">
                    {partnerColumns(sheet).join(', ')}
                  </code>
                </dd>
              </div>
            ))}
            {template.data?.join_note && (
              <p className="text-xs text-ink-500">{template.data.join_note}</p>
            )}
            <p className="text-xs text-ink-500">
              Separate moods with a comma. A CSV carries the venues sheet only — for opening hours
              and menus, use an Excel workbook with sheets named hours and menu.
            </p>
          </dl>
        )}
        {template.isError && (
          <p className="mt-3 text-xs text-ink-500">
            We couldn’t load the column list just now. You can still upload a file you already
            have.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={download}
            disabled={!template.data}
          >
            Download the template
          </Button>
          <input
            ref={fileInput}
            type="file"
            aria-label="Venue spreadsheet"
            accept={ACCEPT}
            disabled={uploading !== null}
            onChange={(event) => {
              choose(event.target.files?.[0])
              event.target.value = '' // so the same file can be re-picked after a fix
            }}
            className="block min-w-56 flex-1 text-sm text-ink-700 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
          />
        </div>

        {file && (
          <div className="mt-5 space-y-3">
            {uploading !== null ? (
              <UploadProgress fileName={file.name} percent={uploading} />
            ) : (
              <p className="text-sm text-ink-900">
                <span className="font-bold">{file.name}</span> is ready. Every venue in it arrives
                as a draft — nothing goes for review and customers see none of it until you add
                photos and submit.
              </p>
            )}
            <Button onClick={start} disabled={uploading !== null}>
              Import venues
            </Button>
          </div>
        )}
      </Card>
    </>
  )
}

/**
 * Three failures, three different things to say — and only the last can be
 * about the partner's file. An upload refused is our request, not their
 * spreadsheet; the paywall is a plan, not a mistake.
 */
function describeStartFailure(err) {
  if (isPaywalled(err)) {
    return {
      tone: 'warning',
      title: 'Spreadsheet upload is on Pro',
      message: 'Your plan doesn’t include it any more. Nothing was imported.',
    }
  }
  if (err?.status === 429) {
    return {
      title: 'That’s a lot of imports in one hour',
      message: 'Try again in a little while. Nothing new was imported.',
    }
  }
  if (err?.stage === 'upload') {
    return {
      title: 'Your file didn’t reach us',
      message: `There’s nothing wrong with your spreadsheet — the upload itself failed. Try again in a moment. (${err.message})`,
    }
  }
  return { title: 'We couldn’t start the import', message: err?.message || 'Please try again.' }
}

/* ---------------------------------------------------------------- the job */

const STAGES = [
  { key: 'uploaded', label: 'File received' },
  { key: 'scanning', label: 'Reading your file' },
  { key: 'reading', label: 'Adding your venues' },
  { key: 'checking', label: 'Finishing up' },
]

function ImportJob({ name, onRestart }) {
  const qc = useQueryClient()

  const status = useQuery({
    queryKey: ['venueImport', name],
    queryFn: () => getVenueImportStatus(name),
    /* Stop on a finished job, and on "no such import" — that is an answer.
       Anything else (a dropped connection) keeps asking. */
    refetchInterval: (query) =>
      isFinished(query.state.data) || query.state.error?.status === 404
        ? false
        : venueImportPolling.intervalMs,
  })
  const job = status.data
  const finished = isFinished(job)

  /* The venue list is stale the moment the job writes; refresh it once. */
  useEffect(() => {
    if (!finished) return
    qc.invalidateQueries({ queryKey: ['venues'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }, [finished, qc])

  const cancel = useMutation({
    mutationFn: () => cancelVenueImport(name),
    onSuccess: (next) => {
      if (next?.name) qc.setQueryData(['venueImport', name], next)
      else status.refetch()
    },
  })

  if (!job) {
    if (status.isError) {
      return (
        <Card title="We can’t find that import">
          <p className="text-sm text-ink-700">
            {status.error?.status === 404
              ? 'It may belong to another account, or the link is incomplete.'
              : status.error?.message}
          </p>
          <div className="mt-4">
            <Button onClick={onRestart}>Upload a file</Button>
          </div>
        </Card>
      )
    }
    return (
      <Card title="Importing your venues">
        <p className="text-sm text-ink-500" role="status">
          Checking on your import…
        </p>
      </Card>
    )
  }

  if (!finished) {
    return (
      <Progress
        job={job}
        onCancel={() => cancel.mutate()}
        cancelling={cancel.isPending}
        cancelError={cancel.error}
      />
    )
  }

  return <Result job={job} onRestart={onRestart} />
}

function Progress({ job, onCancel, cancelling, cancelError }) {
  const current = STAGES.findIndex((s) => s.key === job.stage)
  const counting = job.stage === 'reading' && job.total > 0

  let line = 'Waiting for its turn — this usually takes a few seconds.'
  if (job.status === 'Running' || current > 0) {
    line = counting
      ? `Adding your venues — ${job.processed} of ${job.total}`
      : `${STAGES[Math.max(current, 0)].label}…`
  }

  return (
    <Card title="Importing your venues">
      <p className="text-sm font-medium text-ink-900" role="status">
        {line}
      </p>
      <ol className="mt-4 space-y-1.5">
        {STAGES.map((stage, i) => (
          <li
            key={stage.key}
            className={i <= current ? 'text-sm text-ink-900' : 'text-sm text-ink-500'}
          >
            {i < current ? '✓ ' : i === current ? '→ ' : '· '}
            {stage.label}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-ink-500">
        You can leave this page — the import carries on without it. Come back to this address to
        see how it went.
      </p>
      {cancelError && (
        <Alert variant="danger" className="mt-3">
          We couldn’t stop it: {cancelError.message}
        </Alert>
      )}
      <div className="mt-4">
        <Button variant="secondary" onClick={onCancel} disabled={cancelling}>
          {cancelling ? 'Stopping…' : 'Cancel import'}
        </Button>
      </div>
    </Card>
  )
}

function Result({ job, onRestart }) {
  const venues = job.venues || []
  const errors = job.errors || []
  const failed = job.status === 'Failed'
  const cancelled = job.status === 'Cancelled'

  const counts = [
    [job.created_count, 'added'],
    [job.updated_count, 'updated'],
    [job.skipped_count, 'skipped'],
    [job.menu_items_count, job.menu_items_count === 1 ? 'menu item' : 'menu items'],
  ].filter(([n]) => n > 0)

  return (
    <Card title={failed ? 'The import didn’t run' : cancelled ? 'Import stopped' : 'What happened'}>
      {failed ? (
        <Alert variant="danger">
          <p className="font-bold">We couldn’t import that file, so nothing was added.</p>
          {errors.map((e) => (
            <p key={e} className="mt-1">
              {plainImportError(e)}
            </p>
          ))}
        </Alert>
      ) : (
        <p className="text-sm text-ink-900" role="status">
          {counts.length
            ? counts.map(([n, word]) => `${n} ${word}`).join(', ')
            : 'No venues were added.'}
          {cancelled && '. Venues already added before you stopped it are kept.'}
        </p>
      )}

      {venues.length > 0 && (
        <>
          {/* The no_photos blocker is the expected outcome, not a failure: a
              workbook cannot carry photographs. Said once, with somewhere to go
              on every row. */}
          <Alert variant="info" className="mt-4">
            These are drafts — customers can’t see them yet. Each one needs photos before it can
            go for review: open a venue, add its photos, then send it for review from its page.
          </Alert>
          <ul className="mt-4 divide-y divide-gray-200" aria-label="Imported venues">
            {venues.map((v) => (
              <li key={v.venue} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <Link
                  to={`/venues/${encodeURIComponent(v.venue)}`}
                  className="text-sm font-medium text-brand-ink underline"
                >
                  {v.venue_name}
                </Link>
                <span className="text-xs text-ink-500">
                  {v.action === 'updated' ? 'Updated' : v.action === 'created' ? 'Added' : v.action}
                </span>
                <Badge tone={stateTone(v.workflow_state)}>{stateLabel(v.workflow_state)}</Badge>
                {(v.blockers || []).map((code) => (
                  <span key={code} className="text-xs font-medium text-brand-ink">
                    {blockerLabel(code)}
                  </span>
                ))}
                <Link
                  to={`/venues/${encodeURIComponent(v.venue)}/edit`}
                  aria-label={`Add photos to ${v.venue_name}`}
                  className="ml-auto text-sm font-semibold text-brand-ink underline"
                >
                  Add photos
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {!failed && errors.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-bold text-ink-900">Rows we skipped or changed</h3>
          <p className="mt-1 text-xs text-ink-500">
            Fix these in your spreadsheet and upload it again — venues with an external_ref are
            updated, not added twice.
          </p>
          <ul className="mt-2 space-y-1">
            {errors.map((e) => (
              <li key={e} className="text-xs text-red-700">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        {venues.length > 0 && (
          <Link to="/venues">
            <Button>See your venues</Button>
          </Link>
        )}
        <Button variant="secondary" onClick={onRestart}>
          Upload another file
        </Button>
      </div>
    </Card>
  )
}

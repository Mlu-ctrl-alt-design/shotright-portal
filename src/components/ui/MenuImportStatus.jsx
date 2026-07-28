import { Button, Alert } from './index'
import { clsx } from '../../utils/clsx'
import { buildStageChecklist } from '../../utils/menuImport'

/**
 * The waiting state for a menu import.
 *
 * What a partner needs from a wait, in order of how much it matters:
 *
 *  1. THAT SOMETHING IS HAPPENING. A spinner with no words is indistinguishable
 *     from a hang.
 *  2. WHAT is happening — and specifically, what we found in THEIR file.
 *     "Found 4 categories · reading 38 items" proves we opened it. "Loading"
 *     proves nothing.
 *  3. HOW LONG it should take, before they start wondering.
 *  4. THAT THEY CAN LEAVE. This is the one that actually saves them time, and
 *     it is only shown when it is TRUE — see `canLeave`.
 *  5. A WAY OUT. Offered from the first second, not held back until we have
 *     already wasted their time. Someone who would rather type eight items than
 *     watch a bar should not have to wait 45 seconds to be told they may.
 *
 * The progress bar is deliberately indeterminate until the server reports a row
 * total. A bar that invents its own progress is worse than no bar: it teaches
 * people that the number means nothing, and then they cannot trust the real one.
 */
function Bar({ percent, indeterminate }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-brand-100"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      // Omitted while indeterminate, which is exactly what tells assistive tech
      // "in progress, amount unknown" rather than implying a bogus number.
      aria-valuenow={indeterminate ? undefined : percent}
    >
      <div
        className={clsx(
          'h-full rounded-full bg-brand-500',
          indeterminate
            ? 'w-1/3 motion-safe:animate-[indeterminate_1.4s_ease-in-out_infinite]'
            : 'transition-[width] duration-500',
        )}
        style={indeterminate ? undefined : { width: `${percent}%` }}
      />
    </div>
  )
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** "1.4 MB" — partners recognise their file by name and size, not by id. */
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * One row of the checklist.
 *
 * The marks carry a text alternative each, because the state of a step is
 * information — a screen-reader user who hears four labels and no states learns
 * nothing about which one is running. WCAG 1.4.1 for the same reason: the ring,
 * the tick and the half-filled dot differ in SHAPE, not only in colour.
 */
function Step({ label, detail, status }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {status === 'done' ? (
          <svg viewBox="0 0 20 20" className="size-4 fill-green-700">
            <path
              d="M10 0a10 10 0 100 20 10 10 0 000-20zm4.7 7.7l-5.4 5.4a1 1 0 01-1.4 0L5.3 10.5a1 1 0 111.4-1.4l1.9 1.9 4.7-4.7a1 1 0 111.4 1.4z"
              fillRule="evenodd"
            />
          </svg>
        ) : status === 'active' ? (
          <svg viewBox="0 0 20 20" className="size-4">
            <circle cx="10" cy="10" r="9" className="fill-none stroke-brand-edge stroke-2" />
            <path d="M10 1a9 9 0 010 18z" className="fill-brand-edge" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="size-4">
            <circle cx="10" cy="10" r="9" className="fill-none stroke-ink-500 stroke-2" />
          </svg>
        )}
      </span>
      <span className={clsx('text-sm', status === 'todo' ? 'text-ink-500' : 'text-ink-900')}>
        {label}
        {detail && <span className="text-ink-500"> · {detail}</span>}
        <span className="sr-only">
          {status === 'done' ? ' — done' : status === 'active' ? ' — in progress' : ' — not started'}
        </span>
      </span>
    </li>
  )
}

export default function MenuImportStatus({
  phase,
  job,
  error,
  elapsed,
  estimate,
  canLeave,
  // A SECOND permission, not a detail of the first. `canLeave` says the work
  // outlives the page; `willEmail` says a message is actually coming. Those two
  // shipped weeks apart — the background import went live while outgoing mail
  // was still being configured — and for that window promising both would have
  // told every partner to close the tab and wait for something that was never
  // going to arrive. Defaults to false, so silence is the honest answer.
  willEmail = false,
  uploadPercent,
  fileName,
  fileSize,
  stepLabel,
  onAddManually,
  onCancel,
  onDismiss,
  onReplaceFile,
}) {
  if (phase === 'idle') return null

  /* ------------------------------------------------------------- failed */
  if (phase === 'failed') {
    return (
      <Alert variant="danger">
        <p className="font-bold">We couldn’t read that file</p>
        <p className="mt-1">{error || job?.error_message || 'Something went wrong.'}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button size="sm" variant="secondary" onClick={onReplaceFile || onDismiss}>
            Try another file
          </Button>
          <Button size="sm" variant="ghost" onClick={onAddManually}>
            Add items by hand instead
          </Button>
        </div>
      </Alert>
    )
  }

  /* --------------------------------------------------------------- done */
  if (phase === 'done') {
    const created = job?.created_count ?? 0
    const skipped = job?.skipped_count ?? 0
    const missing = job?.missing_price_count ?? 0
    const errors = job?.errors ?? []

    return (
      <Alert variant={created ? 'success' : 'warning'}>
        <p className="font-bold">
          {created ? `${plural(created, 'item', 'items')} added` : 'Nothing was added'}
        </p>
        {/* Skips, missing prices and row errors are reported, not swallowed. A
            partner whose file had 40 rows and got 38 items needs to know which
            two, or they will assume the whole thing worked and find out from a
            customer. */}
        {skipped > 0 && (
          <p className="mt-1">
            {plural(skipped, 'item was', 'items were')} already on this menu, so we left{' '}
            {skipped === 1 ? 'it' : 'them'} alone.
          </p>
        )}
        {missing > 0 && (
          <p className="mt-1">
            {plural(missing, 'item has', 'items have')} no price yet — {missing === 1 ? 'it' : 'they'}{' '}
            went in at R 0.00 so you can fill {missing === 1 ? 'it' : 'them'} in below.
          </p>
        )}
        {errors.length > 0 && (
          <div className="mt-2">
            <p className="font-semibold">
              {plural(errors.length, 'row', 'rows')} couldn’t be read:
            </p>
            <ul className="mt-1 list-inside list-disc">
              {errors.slice(0, 5).map((e) => (
                <li key={e.row_number}>
                  Row {e.row_number}: {e.message}
                </li>
              ))}
            </ul>
            {errors.length > 5 && <p className="mt-1">…and {errors.length - 5} more.</p>}
          </div>
        )}
        <div className="mt-3">
          <Button size="sm" variant="secondary" onClick={onDismiss}>
            Done
          </Button>
        </div>
      </Alert>
    )
  }

  /* ---------------------------------------------------- uploading / reading */
  const uploading = phase === 'uploading'
  const slow = phase === 'slow'
  const total = job?.total ?? 0
  const processed = job?.processed ?? 0
  const hasRowCounts = total > 0
  const size = formatBytes(fileSize)
  const checklist = buildStageChecklist(uploading ? { stage: 'uploaded' } : job || {})

  return (
    <div
      className={clsx(
        'rounded-3xl border-2 p-5',
        slow ? 'border-brand-edge bg-prefill' : 'border-field bg-white',
      )}
    >
      {stepLabel && (
        <p className="text-xs font-bold tracking-wide text-ink-500 uppercase">{stepLabel}</p>
      )}

      {/* One live region for the whole thing, polite. Announcing every poll
          would talk over a screen-reader user continuously for twenty seconds;
          `aria-live` on a container that changes text a few times does not. */}
      <div role="status" aria-live="polite">
        <p className={clsx('text-lg font-bold text-ink-900', stepLabel && 'mt-1')}>
          {uploading
            ? 'Uploading your menu file…'
            : slow
              ? 'This is taking longer than usual'
              : 'Reading your menu file'}
        </p>

        <ul className="mt-4 space-y-2">
          {checklist.map((step) => (
            <Step key={step.key} {...step} />
          ))}
        </ul>
      </div>

      {/* The file the partner actually chose, named back to them — and a way to
          change their mind about it without hunting for the input again. */}
      {fileName && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-canvas px-4 py-2.5">
          <svg viewBox="0 0 20 20" className="size-4 shrink-0 fill-none stroke-ink-700 stroke-[1.5]">
            <path d="M11.5 2.5H5.5a1 1 0 00-1 1v13a1 1 0 001 1h9a1 1 0 001-1V6.5z" strokeLinejoin="round" />
            <path d="M11.5 2.5v4h4" strokeLinejoin="round" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{fileName}</span>
          {size && <span className="shrink-0 text-sm text-ink-500">{size}</span>}
          {onReplaceFile && (
            <button
              type="button"
              onClick={onReplaceFile}
              className="shrink-0 text-sm font-bold text-brand-ink underline underline-offset-2 hover:text-brand-900"
            >
              Replace file
            </button>
          )}
        </div>
      )}

      <div className="mt-4">
        <Bar
          percent={uploading ? uploadPercent : hasRowCounts ? (processed / total) * 100 : 0}
          indeterminate={!uploading && !hasRowCounts}
        />
      </div>

      {/* THE PROMISE, and it is conditional. `canLeave` is false on the
          synchronous backend, where closing the tab really does lose the
          result — so the copy simply does not make the offer. */}
      {!slow && (
        <p className="mt-3 text-sm text-ink-700">
          This usually takes under {estimate} seconds.
          {canLeave && (
            <>
              {' '}
              <strong>You don’t have to wait</strong> —{' '}
              {willEmail
                ? 'leave this page and we’ll email you the moment your menu is ready.'
                : 'leave this page and come back whenever you like. It keeps going without you, and this panel picks up where it left off.'}
            </>
          )}
          {elapsed > 0 && <span className="text-ink-500"> ({elapsed}s so far)</span>}
        </p>
      )}

      {slow && (
        <p className="mt-3 text-sm text-ink-700">
          {canLeave
            ? `It’s been ${elapsed} seconds. Your menu is still being read and it will finish — ${
                willEmail
                  ? 'leave this page and we’ll email you when it’s done'
                  : 'leave this page and come back to it whenever you like'
              }, or start adding items by hand and we’ll skip anything that arrives twice.`
            : `It’s been ${elapsed} seconds. Please keep this page open a little longer, or add your items by hand instead.`}
        </p>
      )}

      {/* THE WAY OUT, available throughout. Once the estimate has clearly been
          missed it is promoted from a quiet link to a button, and cancelling
          appears beside it — but nobody has to reach 45 seconds to discover
          that typing their menu was always allowed. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        {slow ? (
          <>
            <Button size="sm" onClick={onAddManually}>
              Add your items by hand
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Stop the import
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={onAddManually}
            className="text-sm font-bold text-brand-ink underline underline-offset-2 hover:text-brand-900"
          >
            Taking too long? Add your items by hand instead →
          </button>
        )}
      </div>
    </div>
  )
}

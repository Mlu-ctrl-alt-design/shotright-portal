import { clsx } from '../../utils/clsx'

/**
 * "N of 5 done" — the rail that replaced the step list.
 *
 * ITS OWN BOX, asked for directly: canvas fill, a thin brand-200 ring, 16px
 * corner, with hairlines between the three things it holds. Floating the rail
 * loose in the card made it read as more form — a column of labels beside a
 * column of fields — and the one thing it must not read as is another thing to
 * fill in.
 *
 * WHAT IT COUNTS IS FINISHED SECTIONS, never the one being worked on. A bar
 * that includes the section you are standing in is the small lie that makes
 * every progress bar untrustworthy, and this one is doing the job the old step
 * numbers did badly: answering "how much is left" honestly enough to be worth
 * looking at.
 *
 * Each row is an anchor into the section it names, so the rail is also the
 * navigation. `aria-current` marks the first unfinished one.
 */
function TickIcon({ done }) {
  if (done) {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-px size-4.5 shrink-0 fill-green-700">
        <path d="M10 0a10 10 0 100 20 10 10 0 000-20zm4.7 7.7l-5.4 5.4a1 1 0 01-1.4 0L5.3 10.5a1 1 0 111.4-1.4l1.9 1.9 4.7-4.7a1 1 0 111.4 1.4z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-px size-4.5 shrink-0">
      <circle cx="10" cy="10" r="7" className="fill-none stroke-ink-200 stroke-[2.5]" />
    </svg>
  )
}

function Bar({ done, total }) {
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-brand-100"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${done} of ${total} done`}
    >
      <div
        className="h-full rounded-full bg-brand-500 transition-[width] duration-350"
        style={{ width: `${(done / total) * 100}%` }}
      />
    </div>
  )
}

/**
 * The compact strip, for when the rail does not fit.
 *
 * Same box treatment as the rail — the ring, the fill, the corner — so it reads
 * as the same object having moved rather than as a second, different indicator.
 */
export function ProgressStrip({ sections, className }) {
  const done = sections.filter((s) => s.done).length
  return (
    <div
      className={clsx(
        'rounded-2xl bg-canvas px-4 py-3.5 ring-1 ring-brand-200 ring-inset',
        className,
      )}
    >
      <p className="text-[13px] font-bold text-ink-900">
        {done} of {sections.length} done
      </p>
      <div className="mt-2">
        <Bar done={done} total={sections.length} />
      </div>
    </div>
  )
}

export default function ProgressRail({ sections, className }) {
  const done = sections.filter((s) => s.done).length
  const current = sections.find((s) => !s.done)

  return (
    <nav
      aria-label="Getting listed"
      className={clsx(
        'sticky top-8 w-62 shrink-0 rounded-2xl bg-canvas p-5 ring-1 ring-brand-200 ring-inset',
        className,
      )}
    >
      <p className="text-xs font-bold tracking-wider text-ink-500 uppercase">Getting listed</p>
      <p className="mt-2.5 text-[22px] font-extrabold text-ink-900">
        {done} of {sections.length} done
      </p>
      <div className="mt-2.5">
        <Bar done={done} total={sections.length} />
      </div>

      <ol className="mt-4 flex flex-col gap-0.5 border-t border-brand-200 pt-4">
        {sections.map((section) => (
          <li key={section.key}>
            <a
              href={`#${section.key}`}
              aria-current={section.key === current?.key ? 'step' : undefined}
              className={clsx(
                'flex items-start gap-2.5 rounded-xl px-2 py-2.5 text-[13px] font-semibold transition',
                'hover:bg-brand-50',
                section.key === current?.key ? 'text-ink-900' : 'text-ink-700',
              )}
            >
              <TickIcon done={section.done} />
              <span className="min-w-0 flex-1">
                <span className="block">{section.label}</span>
                <span className="mt-0.5 block text-[11.5px] font-medium text-ink-500">
                  {section.hint}
                </span>
                {/* The tick is decorative; the state is stated here, so it is
                    not carried by shape and colour alone (WCAG 1.4.1). */}
                <span className="sr-only">{section.done ? ' — done' : ' — not done yet'}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>

      <p className="mt-4 border-t border-brand-200 pt-3.5 text-xs text-ink-500">
        Menu comes later. It does not hold up going live.
      </p>
    </nav>
  )
}

import { Link } from 'react-router-dom'
import { Button } from './index'
import { clsx } from '../../utils/clsx'
import { WIZARD_STEPS } from '../../services/wizardSteps'
import { savedAgo } from '../../services/setupDraft'

/**
 * "Pick up where you left off".
 *
 * A partner abandons setup because a delivery arrived, not because they changed
 * their mind. The cost of that interruption is entirely in what they see when
 * they come back: a dashboard that has forgotten them means starting over, and
 * the second attempt is the one people do not finish.
 *
 * So this card answers, in this order, the four questions someone returning
 * after two days actually has:
 *
 *   WHICH venue was I doing?          the name, or an honest "Untitled venue"
 *   HOW FAR did I get?                the rail, with real per-step state
 *   IS IT STILL THERE?                "saved 2 days ago", and the expiry line
 *   HOW DO I CARRY ON?                one button, straight back to that step
 *
 * The rail is the same five steps as the wizard, reusing the same source, so it
 * can never describe a journey the wizard does not have.
 */
function StepPill({ label, status, number }) {
  return (
    <li className="flex items-center gap-2">
      <span className="shrink-0" aria-hidden="true">
        {status === 'done' ? (
          <svg viewBox="0 0 20 20" className="size-5 fill-green-700">
            <path
              d="M10 0a10 10 0 100 20 10 10 0 000-20zm4.7 7.7l-5.4 5.4a1 1 0 01-1.4 0L5.3 10.5a1 1 0 111.4-1.4l1.9 1.9 4.7-4.7a1 1 0 111.4 1.4z"
              fillRule="evenodd"
            />
          </svg>
        ) : status === 'current' ? (
          <span className="grid size-5 place-items-center rounded-full bg-brand-500 text-[10px] font-bold text-ink-900">
            {number}
          </span>
        ) : (
          <svg viewBox="0 0 20 20" className="size-5">
            <circle cx="10" cy="10" r="9" className="fill-none stroke-ink-500 stroke-[1.5]" />
          </svg>
        )}
      </span>
      <span
        className={clsx(
          'text-sm whitespace-nowrap',
          status === 'todo' ? 'text-ink-500' : 'font-medium text-ink-900',
        )}
      >
        {label}
        {/* The mark above is decorative; this is where the state is actually
            stated, so it is not carried by shape or colour alone (WCAG 1.4.1). */}
        <span className="sr-only">
          {status === 'done' ? ' — done' : status === 'current' ? ' — where you left off' : ' — not started'}
        </span>
      </span>
    </li>
  )
}

export default function ResumeSetupCard({ draft, onDiscard }) {
  if (!draft) return null

  const current = draft.stepIndex ?? 0
  const done = new Set(draft.completed || [])
  const saved = savedAgo(draft.updated_at)
  const name = draft.venue_name?.trim()

  // Progress counts FINISHED steps, not the one they are standing on. Filling
  // the bar to include the step still in front of them is the small lie that
  // makes every progress bar untrustworthy.
  const percent = Math.round((done.size / WIZARD_STEPS.length) * 100)

  return (
    <section
      aria-labelledby="resume-setup-heading"
      className="rounded-3xl border-2 border-brand-500 bg-white p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="resume-setup-heading" className="text-xl font-bold text-ink-900">
            Pick up where you left off
          </h2>
          <p className="mt-1 text-sm text-ink-700">
            {/* An unnamed draft says so. Inventing "My venue" would make two
                different abandoned drafts indistinguishable in the list. */}
            <span className={clsx(!name && 'text-ink-500 italic')}>{name || 'Untitled venue'}</span>
            {' · '}
            step {current + 1} of {WIZARD_STEPS.length}, {WIZARD_STEPS[current].short}
          </p>
        </div>
        {saved && (
          <span className="shrink-0 rounded-full bg-canvas px-3 py-1 text-xs font-medium text-ink-700">
            Saved {saved}
          </span>
        )}
      </div>

      <div
        className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-ink-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${done.size} of ${WIZARD_STEPS.length} steps finished`}
      >
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
        {WIZARD_STEPS.map((s, i) => (
          <StepPill
            key={s.key}
            label={s.short}
            number={i + 1}
            status={done.has(s.key) ? 'done' : i === current ? 'current' : 'todo'}
          />
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link to={`/venues/new?draft=${encodeURIComponent(draft.id)}`}>
          <Button>Continue setup</Button>
        </Link>

        {/* THE REASSURANCE, and it is conditional on being true.
            A server-held draft really is on their account and really can be
            emailed to them. A draft sitting in this browser's localStorage is
            neither, and saying otherwise would strand a partner who came back on
            their phone expecting to find it. Same rule as the menu import's
            "you can leave this page". */}
        <p className="text-sm text-ink-700">
          {draft.portable
            ? 'Nothing expires — and we emailed you this link too.'
            : 'Saved in this browser. Finish on this device, or start again elsewhere.'}
        </p>

        {onDiscard && (
          <button
            type="button"
            onClick={() => onDiscard(draft)}
            className="ml-auto text-sm font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900"
          >
            Discard this draft
          </button>
        )}
      </div>
    </section>
  )
}

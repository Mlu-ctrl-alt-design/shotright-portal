import { clsx } from '../../utils/clsx'

/**
 * The vertical progress rail shown on the right of every wizard step.
 *
 * Per the designs: a yellow track line, the current step in bold, finished
 * steps carrying a green tick, and upcoming steps in a lighter yellow.
 */
function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0 fill-green-500" aria-hidden="true">
      <path d="M10 0a10 10 0 100 20 10 10 0 000-20zm4.7 7.7l-5.4 5.4a1 1 0 01-1.4 0L5.3 10.5a1 1 0 111.4-1.4l1.9 1.9 4.7-4.7a1 1 0 111.4 1.4z" />
    </svg>
  )
}

export default function StepRail({ steps, currentIndex, completed = [], onStepClick }) {
  return (
    <nav aria-label="Setup progress" className="border-l-4 border-brand-400 pl-6">
      <ol className="space-y-5">
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex
          const isDone = completed.includes(i)
          // Only steps already visited are safe to jump back to.
          const canNavigate = Boolean(onStepClick) && (isDone || i < currentIndex)

          return (
            <li key={step.key}>
              <button
                type="button"
                disabled={!canNavigate}
                onClick={canNavigate ? () => onStepClick(i) : undefined}
                aria-current={isCurrent ? 'step' : undefined}
                className={clsx(
                  'flex items-center gap-2 text-left transition',
                  canNavigate ? 'cursor-pointer hover:underline' : 'cursor-default',
                  isCurrent
                    ? 'text-lg font-bold text-brand-600'
                    : isDone
                      ? 'text-base font-semibold text-brand-600'
                      : 'text-base font-medium text-brand-300',
                )}
              >
                <span>{step.label}</span>
                {isDone && <CheckIcon />}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

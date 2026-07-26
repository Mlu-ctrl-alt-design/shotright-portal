import { Button } from '../ui'
import StepRail from './StepRail'

/**
 * Chrome for a single wizard step: the white content card with the step rail
 * on the right, and the CANCEL / PREVIOUS / NEXT footer.
 *
 * Step components supply only their own `title`, `subtitle` and `children` —
 * they never render navigation themselves, so the footer stays identical
 * across all five steps as the designs require.
 */
export default function WizardLayout({
  title,
  subtitle,
  steps,
  currentIndex,
  completed,
  onStepClick,
  onCancel,
  onPrevious,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
  nextLoading = false,
  children,
}) {
  const isFirst = currentIndex === 0

  return (
    <div className="rounded-3xl border border-brand-300 bg-white p-8">
      <div className="flex gap-8">
        <div className="min-w-0 flex-1">
          <header>
            <h1 className="text-2xl font-bold text-ink-900">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-ink-700">{subtitle}</p>}
          </header>

          <div className="mt-8">{children}</div>
        </div>

        <aside className="hidden w-64 shrink-0 pt-2 xl:block">
          <StepRail
            steps={steps}
            currentIndex={currentIndex}
            completed={completed}
            onStepClick={onStepClick}
          />
        </aside>
      </div>

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-brand-100 pt-6">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>

        <div className="flex flex-wrap items-center gap-4">
          {!isFirst && (
            <Button variant="secondary" onClick={onPrevious}>
              Previous
            </Button>
          )}
          <Button onClick={onNext} disabled={nextDisabled} loading={nextLoading}>
            {nextLabel}
          </Button>
        </div>
      </footer>
    </div>
  )
}

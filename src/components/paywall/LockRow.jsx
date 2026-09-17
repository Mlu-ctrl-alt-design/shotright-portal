import { Button } from '../ui'

/**
 * A locked feature, in place: a lock glyph, one line, and UNLOCK.
 *
 * DELIBERATELY SMALL, and that is the finding the design rests on. Both of the
 * paywalls studied for this screen — Circle and Elicit — keep the in-place lock
 * to a single line and do the selling in the dialog. A permanent marketing
 * block sitting inside a form is read as an advert by someone who came to do a
 * job, and it pushes the work they DID come for below the fold.
 *
 * So this says what the feature is and gets out of the way. `UpgradeDialog`
 * does the arguing, and only once someone has asked.
 */
export default function LockRow({ children, onUnlock, ctaLabel = 'Unlock' }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-white p-4 ring-1 ring-inset ring-brand-200">
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="size-5 shrink-0 fill-none stroke-brand-ink stroke-[1.75]"
      >
        <rect x="4" y="9" width="12" height="8" rx="2" />
        <path d="M7 9V6.5a3 3 0 0 1 6 0V9" strokeLinecap="round" />
      </svg>
      <p className="min-w-48 flex-1 text-sm text-ink-700">{children}</p>
      <Button shape="field" size="sm" className="shrink-0" onClick={onUnlock}>
        {ctaLabel}
      </Button>
    </div>
  )
}

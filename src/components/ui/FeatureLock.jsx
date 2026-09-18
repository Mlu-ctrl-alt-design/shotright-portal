import { Link } from 'react-router-dom'
import { featureCopy } from '../../services/entitlements'
import { useEntitlements } from '../../hooks/useEntitlements'

/**
 * "This one is on the Pro plan."
 *
 * ⚠️ RENDERS NOTHING unless the paywall is genuinely on, sellable, and this
 * partner genuinely lacks the feature — see `useEntitlements().canPrompt`. Today
 * that means it renders nothing at all on the live site, because every partner
 * is grandfathered and holds all six features. That is the point: the component
 * ships now and lights up the day the cutoff and the RevenueCat keys are set,
 * with no release.
 *
 * It names the feature rather than saying "this is a Pro feature", because the
 * generic version is the same sentence in six places and a partner reading it
 * for the third time has learned nothing about what they would be buying. The
 * words come from the server's catalogue so a copy change is a Desk edit.
 *
 * Deliberately NOT dismissible, and deliberately not a modal — the same two
 * decisions as `LegalBanner`, for the same reasons. A partner can still do
 * everything else on the page.
 */
// UNTITLED UI: https://www.untitledui.com/react/components/settings-pages

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0 fill-none stroke-current stroke-[1.75]" aria-hidden="true">
      <rect x="4" y="8.75" width="12" height="7.5" rx="2" />
      <path d="M7 8.75V6.5a3 3 0 0 1 6 0v2.25" strokeLinecap="round" />
    </svg>
  )
}

/**
 * @param feature  the feature key, e.g. `venue_bulk_import`
 * @param children what to render INSTEAD when the partner does hold it
 */
export default function FeatureLock({ feature, children = null }) {
  const { standing, canPrompt, locked } = useEntitlements()

  if (!canPrompt || !locked(feature)) return children

  const copy = featureCopy(standing, feature)

  return (
    <div
      role="status"
      className="rounded-2xl bg-brand-50 px-4 py-3 text-sm ring-1 ring-inset ring-brand-600/30"
    >
      <p className="flex items-center gap-2 font-bold text-brand-900">
        <LockIcon />
        {copy.label}
      </p>
      {copy.description && <p className="mt-1 text-brand-900">{copy.description}</p>}
      <p className="mt-2 text-brand-900">
        It&rsquo;s part of Pro.{' '}
        <Link className="font-bold underline" to={`/plans?from=${encodeURIComponent(feature)}`}>
          See plans
        </Link>
      </p>
    </div>
  )
}

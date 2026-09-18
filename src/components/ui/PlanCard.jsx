import { Link } from 'react-router-dom'
import { useEntitlements } from '../../hooks/useEntitlements'

/**
 * Which plan this partner is on, and the way to the rest.
 *
 * The quiet half of the paywall. `FeatureLock` appears where somebody has just
 * been stopped; this appears where somebody has gone looking — Settings, and
 * the dashboard. It is the only upgrade surface that is not a refusal, which is
 * why it carries the plan name rather than a feature name.
 *
 * Renders nothing unless the paywall is genuinely on and sellable, same rule as
 * everything else here: a partner who holds every feature has no use for a card
 * telling them what they are missing.
 */
// UNTITLED UI: https://www.untitledui.com/react/components/settings-pages

export default function PlanCard({ className = '' }) {
  const { canPrompt, subscription, standing } = useEntitlements()

  if (!canPrompt) return null

  const plan = subscription?.plan || 'Free'
  const paid = (standing?.plans || []).find((p) => !p.is_default)
  const locked = (standing?.gated || []).filter((k) => !(standing?.features || []).includes(k))

  return (
    <section
      className={`rounded-3xl bg-white p-6 ring-1 ring-inset ring-black/5 ${className}`}
    >
      <p className="text-sm font-bold text-ink-900">You&rsquo;re on {plan}</p>
      <p className="mt-1 text-sm text-ink-600">
        {locked.length > 0
          ? `${locked.length} ${locked.length === 1 ? 'feature is' : 'features are'} on ${
              paid?.plan || 'Pro'
            }.`
          : 'You have everything.'}
      </p>
      <Link className="mt-3 inline-block text-sm font-bold text-brand-700 underline" to="/plans">
        See plans
      </Link>
    </section>
  )
}

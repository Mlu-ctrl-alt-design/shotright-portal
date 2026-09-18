import { useEntitlements } from '../../hooks/useEntitlements'
import { featureCopy } from '../../services/entitlements'
import Spinner from '../../components/ui/Spinner'

/**
 * What the plans are, and which one this partner is on.
 *
 * Where all six upgrade surfaces point, and — because RevenueCat's checkout
 * leaves the browser entirely and comes back via a redirect configured in their
 * dashboard — the one URL that has to exist for a purchase to land anywhere.
 * That is why this is a route and not a sheet: a modal cannot be a redirect
 * target.
 */
// UNTITLED UI: https://www.untitledui.com/react/components/pricing-sections

const rands = (amount) =>
  Number(amount) === 0 ? 'Free' : `R${Number(amount || 0).toLocaleString('en-ZA')}`

export default function Plans() {
  const { standing, isLoading, plans, subscription } = useEntitlements()

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-ink-900">Your plan</h1>
        <p className="mt-1 text-sm text-ink-600">
          {subscription
            ? `You're on ${subscription.plan}.`
            : 'What you can do today, and what more would cost.'}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((plan) => {
          const current = subscription ? subscription.plan === plan.plan : Boolean(plan.is_default)
          return (
            <section
              key={plan.plan}
              className="rounded-3xl bg-white p-6 ring-1 ring-inset ring-black/5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-black text-ink-900">{plan.plan}</h2>
                {current && (
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-900">
                    Your plan
                  </span>
                )}
              </div>

              <p className="mt-2 text-2xl font-black text-ink-900">
                {rands(plan.price_zar)}
                {Number(plan.price_zar) > 0 && (
                  <span className="text-sm font-bold text-ink-600">
                    {' '}
                    / {String(plan.interval || 'Monthly').toLowerCase().replace(/ly$/, '')}
                  </span>
                )}
              </p>

              {/* The words come from the server's catalogue. A table in this
                  repo would make every copy change a release, and would render
                  a seventh feature as a raw key. */}
              <ul className="mt-4 space-y-2">
                {plan.features.map((key) => {
                  const copy = featureCopy(standing, key)
                  return (
                    <li key={key} className="text-sm text-ink-900">
                      <span className="font-bold">{copy.label}</span>
                      {copy.description && (
                        <span className="block text-ink-600">{copy.description}</span>
                      )}
                    </li>
                  )
                })}
                {plan.features.length === 0 && (
                  <li className="text-sm text-ink-600">
                    Everything you need to list a venue and take bookings.
                  </li>
                )}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}

import { useLocation } from 'react-router-dom'
import { useEntitlements } from '../../hooks/useEntitlements'

/**
 * "Something about your subscription needs you."
 *
 * ⚠️ NOT THE UPGRADE PITCH, and deliberately in a different place from it.
 *
 * The upgrade prompt lives at six specific surfaces and never in the shell,
 * because the same offer on every screen is how a banner becomes wallpaper. A
 * failing payment is not an offer: it is a paying partner about to lose
 * something they want to keep, inside a window that closes. That earns the
 * shell, the same way `LegalBanner` does.
 *
 * Follows LegalBanner in all three of its decisions:
 *   - **Shell-level**, so it is seen rather than found.
 *   - **Never dismissible.** A dismissible banner is a banner that gets
 *     dismissed, and this is the only warning before a subscription lapses.
 *   - **Hidden on `/plans`**, because pointing at the page you are already on
 *     is noise, and noise is how a banner stops being read.
 *
 * It renders for people who are ALREADY PAYING, so unlike `FeatureLock` it does
 * not check `canPrompt` — a partner whose card just failed needs to hear about
 * it whether or not this server can currently sell them anything.
 */
// UNTITLED UI: https://www.untitledui.com/react/components/settings-pages

/**
 * How close to the end of a trial is worth interrupting someone over.
 *
 * Three days. Long enough to act on, short enough that a partner still
 * evaluating is left alone — the whole point of a trial is that they are
 * deciding, and a banner from day one is a sales pitch wearing a warning's
 * clothes.
 */
export const TRIAL_WARNING_DAYS = 3

/** "15 October 2026" — a date a person can act on, not 2026-10-15. */
const asDate = (value) => {
  const when = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(when.getTime())) return ''
  return when.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

const daysUntil = (value) => {
  const when = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(when.getTime())) return null
  return Math.ceil((when.getTime() - Date.now()) / 86400000)
}

function Banner({ label, title, children }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="mb-4 rounded-2xl bg-brand-50 px-4 py-3 text-sm ring-1 ring-inset ring-brand-600/30"
    >
      <p className="font-bold text-brand-900">{title}</p>
      <p className="mt-1 text-brand-900">{children}</p>
    </div>
  )
}

export default function SubscriptionBanner() {
  const { subscription, manageUrl } = useEntitlements()
  const { pathname } = useLocation()

  if (!subscription || pathname === '/plans') return null

  const manage = manageUrl ? (
    <a className="font-bold underline" href={manageUrl} target="_blank" rel="noopener noreferrer">
      Update your card
    </a>
  ) : null

  /* Ordered by urgency, and only ever one at a time. A screen carrying three
     subscription banners has stopped communicating. */
  if (subscription.paymentFailed) {
    return (
      <Banner label="Payment problem" title="Your last payment didn't go through">
        {/* Says plainly that access continues. The backend keeps a Past Due
            subscription live on purpose while the store retries the card, and a
            banner implying otherwise would panic somebody whose venue is
            working perfectly well. */}
        Nothing is locked and your venues are still live. Your bank will try again, but
        updating your card now is the surest fix. {manage}
      </Banner>
    )
  }

  if (subscription.cancelAtPeriodEnd && subscription.periodEnd) {
    return (
      <Banner label="Plan ending" title={`Your ${subscription.plan} plan ends on ${asDate(subscription.periodEnd)}`}>
        {/* Factual, not a win-back nag. They cancelled on purpose, and being
            sold to on the way out is how a partner leaves for good. */}
        You keep everything until then. After that your venues stay live, but the Pro
        features switch off.
      </Banner>
    )
  }

  if (subscription.status === 'Trialing' && subscription.periodEnd) {
    const left = daysUntil(subscription.periodEnd)
    if (left !== null && left <= TRIAL_WARNING_DAYS) {
      return (
        <Banner
          label="Trial ending"
          title={
            left <= 0
              ? 'Your trial ends today'
              : `Your trial ends in ${left} ${left === 1 ? 'day' : 'days'}`
          }
        >
          Nothing changes today. When it ends you&rsquo;ll move to the Free plan unless you
          pick one.
        </Banner>
      )
    }
  }

  return null
}

import { useEffect, useRef, useState } from 'react'
import { Alert, Button } from '../ui'
import ProBadge from './ProBadge'
import { PRO_PRICE, startCheckout } from '../../services/plan'

/**
 * The upgrade dialog — where the Pro case is actually made.
 *
 * SHAPE TAKEN FROM TWO PATTERNS that do the same three things, and neither of
 * them front-loads a marketing block into the product:
 *
 *   1. The pitch and the price sit together, on the left.
 *   2. The PRICE AND ITS CADENCE ARE EXPLICIT — "R149 / per month", with
 *      "cancel any time" under it. A paywall that hides the recurrence until
 *      checkout is the thing people write angry reviews about.
 *   3. "Everything in Free, plus:" on the right, as a ticked list. Framing it
 *      as an addition to what they already have, rather than a list of what
 *      they are missing, is the difference between an offer and a scolding.
 *
 * "Maybe later" is a real, prominent, plain-language way out. A dialog whose
 * only visible exit is a grey ✕ in a corner is a dark pattern, and this one is
 * dismissible four ways: the button, the ✕, Escape, and the backdrop.
 *
 * ACCESSIBILITY — this is a modal, so it owes the full contract, none of which
 * the HTML prototype had:
 *   - focus moves in on open and RETURNS to the trigger on close, so somebody
 *     who opened a lock with the keyboard is not dumped at the top of the page
 *   - Tab is trapped inside while it is open
 *   - Escape closes
 *   - `aria-modal` + `aria-labelledby` so the heading is announced
 *   - the page behind it does not scroll
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const PRO_FEATURES = [
  'Import from Google, Facebook or your website',
  'Several venues at once from one spreadsheet',
  'Menus imported from a photo, PDF or spreadsheet',
  'Booking numbers per venue',
  'Unlimited venues on one account',
]

export default function UpgradeDialog({ open, onClose }) {
  const panelRef = useRef(null)
  const returnTo = useRef(null)
  const [checkout, setCheckout] = useState({ status: 'idle' })

  useEffect(() => {
    if (!open) return undefined

    returnTo.current = document.activeElement
    /* The close button rather than the Upgrade button: opening a dialog with
       the spend action already focused is one stray Enter away from a purchase
       nobody chose. */
    const first = panelRef.current?.querySelector('[data-autofocus]')
    first?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const nodes = [...(panelRef.current?.querySelectorAll(FOCUSABLE) || [])]
      if (!nodes.length) return
      const firstNode = nodes[0]
      const lastNode = nodes[nodes.length - 1]
      // Wrap by hand. Without this, Tab walks straight out of the dialog and
      // into the form behind it, which is still there and still operable.
      if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault()
        lastNode.focus()
      } else if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault()
        firstNode.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      returnTo.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  /**
   * ⚠️ THERE IS NO CHECKOUT YET, and this button refuses to pretend there is.
   *
   * The Payfast adapter is still to be built — `Vendor Subscription` and
   * `Subscription Event` exist on the bench with nowhere for a payment to come
   * from. A button that looks like it takes payment and silently does nothing
   * is the worst available outcome here: the partner believes they have
   * subscribed, finds the feature still locked, and now distrusts both the
   * paywall and the invoice they are waiting for.
   *
   * So the portal ASKS the bench, and says plainly what came back. The moment
   * the adapter lands this starts working with no change here.
   */
  const upgrade = async () => {
    setCheckout({ status: 'starting' })
    const result = await startCheckout()
    if (result.redirectUrl) {
      window.location.assign(result.redirectUrl)
      return
    }
    setCheckout({ status: 'unavailable' })
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink-900/45 p-6"
      // A backdrop click closes; a click that STARTED inside and ended out here
      // (a drag across the text) must not, which is what the target check does.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upgrade-dialog-heading"
        className="relative flex w-full max-w-3xl flex-wrap overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <button
          type="button"
          data-autofocus
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3.5 right-3.5 grid size-9 place-items-center rounded-full text-ink-500 transition hover:bg-canvas hover:text-ink-900"
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="size-4 fill-none stroke-current stroke-[1.75]"
          >
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>

        {/* ------------------------------------------------------- the pitch */}
        <div className="min-w-0 flex-1 basis-80 px-8 pt-9 pb-8">
          <ProBadge />
          <h2 id="upgrade-dialog-heading" className="mt-3.5 text-[22px] font-bold text-ink-900">
            Stop typing your venues in
          </h2>
          <p className="mt-2 text-sm text-ink-700 text-pretty">
            Import from Google, Facebook or your website — or a whole spreadsheet at once. About 15
            minutes saved per venue.
          </p>

          <p className="mt-6 flex items-baseline gap-1.5">
            <span className="text-4xl font-bold tracking-tight text-ink-900">
              {PRO_PRICE.amount}
            </span>
            <span className="text-sm text-ink-500">{PRO_PRICE.cadence}</span>
          </p>
          <p className="mt-1 text-xs text-ink-500">Cancel any time. Your venues stay listed.</p>

          {checkout.status === 'unavailable' && (
            <Alert variant="warning" className="mt-4">
              <p className="font-bold">Pro isn’t on sale yet</p>
              <p className="mt-1">
                We can’t take payment on this account right now. Nothing has been charged — carry
                on and type it in, and we’ll have this ready shortly.
              </p>
            </Alert>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button shape="field" loading={checkout.status === 'starting'} onClick={upgrade}>
              Upgrade to Pro
            </Button>
            <Button variant="ghost" caps={false} onClick={onClose}>
              Maybe later
            </Button>
          </div>
        </div>

        {/* ------------------------------------------------------ what's in it */}
        <div className="min-w-0 flex-1 basis-72 bg-canvas px-8 pt-9 pb-8 ring-1 ring-ink-200 ring-inset">
          <p className="text-sm font-bold text-ink-900">Everything in Free, plus:</p>
          <ul className="mt-4 flex flex-col gap-3">
            {PRO_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-ink-900 text-pretty">
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 fill-green-700"
                >
                  <path d="M10 0a10 10 0 100 20 10 10 0 000-20zm4.7 7.7l-5.4 5.4a1 1 0 01-1.4 0L5.3 10.5a1 1 0 111.4-1.4l1.9 1.9 4.7-4.7a1 1 0 111.4 1.4z" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
          <a
            href="/profile"
            className="mt-5 inline-block text-sm font-semibold text-brand-ink underline"
          >
            See all plans
          </a>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Alert } from '../ui'
import { getSubscription } from '../../services/plan'

/** How long to wait for Payfast's notification before saying so: every 3s
    for a minute. An object so tests can shorten it. */
export const paymentPolling = { intervalMs: 3000, tries: 20 }

/**
 * What happened at Payfast, said on the way back.
 *
 * The bench sends Payfast `?payment=success|cancelled&attempt=VPA-…` as the
 * return and cancel URLs (shotright PR #59). Without this the partner simply
 * reappeared on the dashboard with no word about the money they had just
 * spent — and Pro not showing yet, because Payfast tells the BENCH (the ITN)
 * a few seconds after it sends the browser back.
 *
 * So on success this waits for the subscription to turn Active, then says so
 * and refreshes everything that reads entitlements. The query string is
 * removed straight away, so a reload or a back-button does not replay it.
 */
export default function PaymentReturnBanner() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [state, setState] = useState(null) // {kind, attempt}
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    const params = new URLSearchParams(location.search)
    const outcome = params.get('payment')
    if (outcome !== 'success' && outcome !== 'cancelled') return
    started.current = true

    const attempt = params.get('attempt') || null
    params.delete('payment')
    params.delete('attempt')
    const search = params.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })

    if (outcome === 'cancelled') {
      setState({ kind: 'cancelled', attempt })
      return
    }

    setState({ kind: 'waiting', attempt })
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < paymentPolling.tries && !cancelled; i++) {
        const sub = await getSubscription()
        if (cancelled) return
        if (sub?.status === 'Active') {
          queryClient.invalidateQueries({ queryKey: ['entitlements'] })
          queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          setState({ kind: 'active', attempt, plan: sub.plan || 'Pro' })
          return
        }
        await new Promise((r) => setTimeout(r, paymentPolling.intervalMs))
      }
      if (!cancelled) setState({ kind: 'slow', attempt })
    })()
    return () => {
      cancelled = true
    }
    // Once per arrival: the ref guards StrictMode's double effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!state) return null

  const dismiss = (
    <button
      type="button"
      onClick={() => setState(null)}
      className="mt-2 text-sm font-semibold underline underline-offset-2"
    >
      Dismiss
    </button>
  )

  return (
    <div role="status" className="mb-4">
      {state.kind === 'waiting' && (
        <Alert variant="info">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700"
            />
            <p className="font-bold">Payment received — switching on Pro…</p>
          </div>
          <p className="mt-1">This usually takes a few seconds. You can keep working.</p>
        </Alert>
      )}
      {state.kind === 'active' && (
        <Alert variant="success">
          <p className="font-bold">{state.plan} is on. Thank you!</p>
          <p className="mt-1">Everything in your plan is unlocked now.</p>
          {dismiss}
        </Alert>
      )}
      {state.kind === 'slow' && (
        <Alert variant="warning">
          <p className="font-bold">Your payment went through, but Pro isn’t on yet</p>
          <p className="mt-1">
            It can take a few minutes for Payfast to confirm. Refresh this page in a little while.
            If it’s still off after that, contact us
            {state.attempt ? (
              <>
                {' '}
                and quote <strong>{state.attempt}</strong>
              </>
            ) : null}
            .
          </p>
          {dismiss}
        </Alert>
      )}
      {state.kind === 'cancelled' && (
        <Alert variant="info">
          <p className="font-bold">Payment cancelled</p>
          <p className="mt-1">Nothing was charged. You can upgrade whenever you’re ready.</p>
          {dismiss}
        </Alert>
      )}
    </div>
  )
}

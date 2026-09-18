import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { refreshSubscription } from '../services/entitlements'
import { ENTITLEMENTS_QUERY_KEY } from './useEntitlements'

/**
 * How long to keep asking RevenueCat whether the purchase landed.
 *
 * The vendor is redirected back here about two seconds after paying, while
 * RevenueCat's webhook is documented as taking five to sixty. `refresh_subscription`
 * asks RevenueCat's REST API directly, which knows sooner than the webhook
 * arrives — but not always instantly.
 *
 * Three attempts over four seconds. Bounded because this is a write and it calls
 * an external API: a poll loop would hammer RevenueCat on behalf of someone who
 * closed the tab. After the last one the page says so honestly and offers to
 * look again, rather than silently showing Free to someone who has just been
 * charged.
 */
export const RETRY_DELAYS_MS = [0, 1500, 4000]

/** The query parameter RevenueCat's dashboard redirect must carry. */
export const RETURN_PARAM = 'checkout'

/**
 * Reconcile the subscription after a return from checkout.
 *
 * ⚠️ ONLY on a return, never on an ordinary visit. `refresh_subscription` is a
 * POST that writes, and an upgrade screen that writes every time it is opened
 * is a write nobody asked for — plus an outbound RevenueCat call per page view.
 * The return is signalled by `?checkout=` on the URL, which is why RevenueCat's
 * redirect must be configured as `<portal>/plans?checkout=return` rather than
 * bare `/plans`.
 */
export function useCheckoutReturn() {
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const returning = params.has(RETURN_PARAM)
  const started = useRef(false)
  const [state, setState] = useState(returning ? 'checking' : 'idle')

  useEffect(() => {
    if (!returning || started.current) return
    started.current = true

    let cancelled = false
    const timers = []

    const attempt = async (index) => {
      if (cancelled) return
      let result = null
      try {
        result = await refreshSubscription()
      } catch {
        // A failed refresh is not a failed purchase. Fall through to the next
        // attempt, and to the honest message if they all fail.
      }
      if (cancelled) return

      if (result?.plan) {
        /* Invalidated rather than written straight into the cache. The refresh
           response carries the whole entitlement payload, but in the SERVER's
           shape — the cache holds the normalised one, so putting it in
           unconverted would poison every consumer with snake_case keys. One
           extra round trip is the cheaper mistake. */
        qc.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY })
        setState('done')
        return
      }

      const next = index + 1
      if (next >= RETRY_DELAYS_MS.length) {
        setState('slow')
        return
      }
      timers.push(setTimeout(() => attempt(next), RETRY_DELAYS_MS[next]))
    }

    attempt(0)
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [returning, qc])

  return {
    returning,
    /** 'idle' | 'checking' | 'done' | 'slow' */
    state,
    checkAgain: () => {
      started.current = false
      setState('checking')
      qc.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY })
    },
  }
}

import { useQuery } from '@tanstack/react-query'
import {
  getEntitlements,
  hasFeature,
  shouldPromptUpgrade,
} from '../services/entitlements'

export const ENTITLEMENTS_QUERY_KEY = ['entitlements']

/**
 * Where the partner stands with the Pro plan.
 *
 * One query, one cache entry, six consumers: the plans page, the card in
 * Settings, the one on the dashboard, and the locks on bulk import, menu import
 * and booking numbers. They must never disagree — a lock on a button beside a
 * card saying "you're on Pro" is how a partner learns to distrust the screen.
 *
 * `canPrompt` is the only thing a banner may gate on, and it is FALSE while
 * loading. A prompt that appears before the answer arrives flashes an upgrade
 * offer at somebody who has already paid; the same reasoning as
 * `useLegalStanding().blocks`, which is false while loading for the same
 * reason.
 *
 * `locked(key)` is the inverse of `has(key)` and is deliberately false when we
 * could not ask. Drawing a lock over a feature a paying partner holds, because
 * one request timed out, is the worst direction to be wrong in.
 */
export function useEntitlements() {
  const query = useQuery({
    queryKey: ENTITLEMENTS_QUERY_KEY,
    queryFn: getEntitlements,
    /* A plan changes when somebody buys one, and the buy flow invalidates this
       key itself. Five minutes keeps a request off the front of every screen
       the shell renders, which is the same bargain `useLegalStanding` makes. */
    staleTime: 5 * 60 * 1000,
  })

  const standing = query.data

  return {
    ...query,
    standing,
    /** Whether an upgrade prompt is honest right now. */
    canPrompt: !query.isLoading && shouldPromptUpgrade(standing),
    /** Does this partner hold this feature? */
    has: (key) => hasFeature(standing, key),
    /** Should this feature be drawn with a lock? */
    locked: (key) => Boolean(standing?.available) && !hasFeature(standing, key),
    subscription: standing?.subscription || null,
    manageUrl: standing?.manageUrl || null,
    plans: standing?.plans || [],
  }
}

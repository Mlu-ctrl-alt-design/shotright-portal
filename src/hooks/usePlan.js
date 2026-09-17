import { useQuery } from '@tanstack/react-query'
import { getEntitlements, hasFeature } from '../services/plan'

/**
 * What this account is entitled to.
 *
 * Cached hard for the tab. A subscription does not change while somebody fills
 * in a venue form, and refetching on window focus would let a partner watch a
 * feature lock itself mid-sentence because a background call answered slowly.
 *
 * `retry: false` for the same reason `getEntitlements` never throws: a failed
 * read means UNLOCKED, and retrying it three times only delays the unlock.
 */
export const useEntitlements = () =>
  useQuery({
    queryKey: ['entitlements'],
    queryFn: getEntitlements,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })

/**
 * Is one feature available?
 *
 * ⚠️ `locked` is false WHILE THE ANSWER IS STILL IN FLIGHT, and that is the
 * whole design of this hook rather than an oversight.
 *
 * A lock that paints itself in for half a second before disappearing tells a
 * paying partner they have lost access to something they bought. They see it,
 * they do not see it go, and they are on support before the query resolves.
 * Revealing a lock a beat late costs nothing — the search box behind it was not
 * going to be typed into in the first 300ms either.
 *
 * `ready` is exposed for the rare caller that genuinely needs to wait, but the
 * paywall screens deliberately do not use it.
 */
export function useFeature(feature) {
  const { data, isPending } = useEntitlements()
  return {
    locked: !isPending && !hasFeature(data, feature),
    ready: !isPending,
    plan: data?.plan ?? null,
  }
}

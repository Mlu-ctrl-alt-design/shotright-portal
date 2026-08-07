import { useQuery } from '@tanstack/react-query'
import { canEnforce, ENFORCE_AT, getLegalDocuments } from '../services/legal'

export const LEGAL_QUERY_KEY = ['legal', 'standing']

/**
 * Where the partner stands with the legal documents.
 *
 * One query, one cache entry, three consumers: the banner in the shell, the
 * screen at `/legal`, and the gate on submitting a venue. They must never
 * disagree — a banner saying "action needed" over a submit button that works is
 * how a partner learns to ignore the banner.
 *
 * `blocks` is the only thing callers should gate on, and it is deliberately
 * conservative in both directions:
 *
 *   - It is FALSE while loading. A gate that engages before the answer arrives
 *     flickers a legal wall in front of someone who has already accepted.
 *   - It is FALSE when we could not ask. We do not hold a partner to an
 *     agreement we cannot show them, and we cannot record one either — see
 *     `canEnforce`. A venue reaching the review queue unaccepted is recoverable
 *     by a human; a partner locked out of their own venues at 6pm on a Friday
 *     is not.
 */
export function useLegalStanding() {
  const query = useQuery({
    queryKey: LEGAL_QUERY_KEY,
    queryFn: getLegalDocuments,
    /* Legal documents change a few times a year. Re-asking on every mount buys
       nothing and puts a request in front of every screen the shell renders. */
    staleTime: 5 * 60 * 1000,
  })

  const standing = query.data
  const outstanding = standing?.outstanding || []

  return {
    ...query,
    standing,
    outstanding,
    /** Something to accept, and we are able to say so. */
    pending: Boolean(standing?.available && outstanding.length > 0),
    /** Something to accept, and we are able to hold them to it. */
    blocks:
      ENFORCE_AT === 'submit' &&
      !query.isLoading &&
      canEnforce(standing) &&
      outstanding.length > 0,
  }
}

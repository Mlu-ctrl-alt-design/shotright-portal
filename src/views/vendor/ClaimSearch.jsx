import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Badge, Button, Card, EmptyState, Input } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import {
  MIN_QUERY,
  MY_CLAIMS_QUERY,
  OPEN_STATUSES,
  getMyClaims,
  searchClaimable,
  startClaim,
  withdrawClaim,
} from '../../services/claims'

/**
 * "Is your venue already on Sho't Right?" — the portal's own way into a claim.
 *
 * The catalogue holds over a thousand venues nobody has claimed yet. A partner
 * who types their restaurant into Add New would make a duplicate of one of
 * them; this is where they find the original instead. Choosing a venue opens a
 * claim on the bench and goes to the same `/claim/<token>` page the customer
 * app sends people to, so there is one place a claim is finished, not two.
 *
 * A venue somebody else holds is still claimable — that is the real owner whose
 * restaurant was listed by someone else — but it is labelled before the tap, so
 * the partner knows it will be a dispute rather than finding out afterwards.
 */
export default function ClaimSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), 300)
  const [message, setMessage] = useState(null)

  const results = useQuery({
    queryKey: ['venue-claims', 'search', debounced],
    queryFn: () => searchClaimable(debounced),
    enabled: debounced.length >= MIN_QUERY,
  })

  const claims = useQuery({ queryKey: MY_CLAIMS_QUERY, queryFn: getMyClaims })

  const start = useMutation({
    mutationFn: (venue) => startClaim(venue.id),
    onSuccess: (result) => {
      if (result.token) {
        navigate(`/claim/${result.token}`)
        return
      }
      // Already filed: the bench does not issue a second link for it.
      setMessage(`Your claim for ${result.venueName} is already with us. We'll email you when it's decided.`)
      claims.refetch()
    },
  })

  const rows = results.data || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Claim your venue</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Many venues are already in our catalogue. If yours is, claim it here instead of adding it again. We&rsquo;ll
          check that it&rsquo;s yours, usually the same day.
        </p>
      </div>

      <Card>
        <Input
          label="Venue name"
          aria-label="Venue name"
          type="search"
          value={query}
          placeholder="Start typing your venue's name"
          onChange={(e) => {
            setQuery(e.target.value)
            setMessage(null)
            start.reset()
          }}
          hint={query.trim().length > 0 && query.trim().length < MIN_QUERY ? `Type at least ${MIN_QUERY} characters.` : undefined}
        />

        <div className="mt-4 space-y-3">
          <Alert variant="success">{message}</Alert>
          <Alert variant="danger">{start.error?.message}</Alert>
          {results.isError && <Alert variant="danger">{results.error.message}</Alert>}

          {results.isFetching && <Spinner label="Searching…" />}

          {debounced.length >= MIN_QUERY && results.isSuccess && rows.length === 0 && (
            <EmptyState
              title={`No catalogue venue matches "${debounced}"`}
              description="If your venue isn't here, you can add it yourself."
              action={
                <Button variant="secondary" onClick={() => navigate('/venues/new')}>
                  Add a new venue
                </Button>
              }
            />
          )}

          {rows.length > 0 && (
            <ul aria-label="Matching venues" className="divide-y divide-ink-100">
              {rows.map((venue) => (
                <li key={venue.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900">{venue.name}</p>
                    <p className="text-sm text-ink-500">
                      {[venue.town, venue.province].filter(Boolean).join(', ') || 'Location not listed'}
                    </p>
                    {venue.owned && (
                      <p className="mt-1 text-xs text-brand-ink">
                        Someone has already listed this venue. You can still claim it if it&rsquo;s yours, but
                        we&rsquo;ll need stronger proof.
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    aria-label={`Claim ${venue.name}`}
                    onClick={() => start.mutate(venue)}
                    disabled={start.isPending}
                  >
                    {start.isPending && start.variables?.id === venue.id ? 'Opening…' : 'This is my venue'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <MyClaims query={claims} />
    </div>
  )
}

const STATUS_TONE = {
  Started: 'Draft',
  Submitted: 'Pending',
  Granted: 'Approved',
  Declined: 'Declined',
  Withdrawn: 'Draft',
  Revoked: 'Declined',
}

const STATUS_LABEL = {
  Started: 'Not submitted',
  Submitted: 'Under review',
  Granted: 'Approved',
  Declined: 'Declined',
  Withdrawn: 'Withdrawn',
  Revoked: 'Revoked',
}

function MyClaims({ query }) {
  if (query.isLoading) return null
  // Quietly absent rather than an error box: the search above still works, and
  // this list is a convenience on top of the emails the bench already sends.
  if (query.isError || !query.data?.length) return null

  return (
    <Card title="Your claims">
      <ul aria-label="Your claims" className="divide-y divide-ink-100">
        {query.data.map((row) => (
          <MyClaim key={row.claim} row={row} />
        ))}
      </ul>
    </Card>
  )
}

/**
 * One of the partner's own claims, with a way to take it back while it is open.
 *
 * Withdrawing asks first, inline, because it cannot be undone — a withdrawn
 * claim is closed for good, and claiming again means starting from the search
 * — and because a filed claim on somebody else's listing tells that partner it
 * has been withdrawn.
 */
function MyClaim({ row }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const withdraw = useMutation({
    mutationFn: () => withdrawClaim(row.claim),
    onSuccess: () => {
      setConfirming(false)
      queryClient.invalidateQueries({ queryKey: MY_CLAIMS_QUERY })
    },
  })

  const open = OPEN_STATUSES.includes(row.status)

  return (
    <li className="space-y-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">{row.venueName}</p>
          {row.status === 'Started' && (
            <p className="text-sm text-ink-500">Search for it again above to finish this claim.</p>
          )}
          {row.reason && <p className="text-sm text-ink-500">{row.reason}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status] || row.status}</Badge>
          {open && !confirming && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Withdraw your claim on ${row.venueName}`}
              onClick={() => {
                withdraw.reset()
                setConfirming(true)
              }}
            >
              Withdraw
            </Button>
          )}
        </div>
      </div>

      {confirming && (
        <div role="group" aria-label={`Withdraw your claim on ${row.venueName}?`} className="space-y-3 rounded-2xl bg-canvas p-4">
          <p className="text-sm text-ink-900">
            Withdraw your claim on <strong>{row.venueName}</strong>? It closes for good, and to claim the venue later
            you would start again.
          </p>
          <Alert variant="danger">{withdraw.error?.message}</Alert>
          <div className="flex flex-wrap gap-3">
            <Button size="sm" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
              {withdraw.isPending ? 'Withdrawing…' : 'Yes, withdraw it'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)} disabled={withdraw.isPending}>
              Keep my claim
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}

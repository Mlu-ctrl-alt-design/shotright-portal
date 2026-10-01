import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Badge, Button, Card, EmptyState, Textarea } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import {
  EVIDENCE_ACCEPT,
  MAX_EVIDENCE_FILES,
  MAX_EVIDENCE_MB,
  MAX_RESPONSE_CHARS,
  ON_MY_VENUES_QUERY,
  getClaimsOnMyVenues,
  removeResponseEvidence,
  respondToClaim,
  uploadResponseEvidence,
} from '../../services/claims'

/**
 * "Claims on your venues" — the other side of a dispute.
 *
 * Somebody has filed a claim saying a venue this partner lists is really
 * theirs. Until now the partner's only way to answer was to reply to an email;
 * the claimant had a form, a note and six documents. This page gives the owner
 * the same footing: a written answer and their own documents, which the
 * reviewer reads beside the claimant's before deciding.
 *
 * What the bench never sends here, and this page therefore cannot show: who
 * made the claim. At this stage it is an assertion, not a finding.
 *
 * The copy leans hard on "nothing has changed", because the first reaction to
 * "someone has claimed your restaurant" is panic about bookings — and nothing
 * moves until a person decides.
 */
export default function ClaimsOnMyVenues() {
  const claims = useQuery({ queryKey: ON_MY_VENUES_QUERY, queryFn: getClaimsOnMyVenues })

  if (claims.isLoading) return <Spinner label="Loading claims…" />
  if (claims.isError) {
    return <Alert variant="danger">We couldn&rsquo;t load claims on your venues. Try again in a moment.</Alert>
  }

  const rows = claims.data || []
  const open = rows.filter((row) => row.status === 'Submitted')
  const answered = rows.filter((row) => row.status !== 'Submitted')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Claims on your venues</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          When someone says a venue you list is really theirs, it shows up here. Nothing changes while a claim is
          under review: your listing stays yours and your bookings are unaffected. A person reads both sides before
          anything is decided.
        </p>
      </div>

      {rows.length === 0 && (
        <EmptyState
          title="No claims on your venues"
          description="If someone ever claims one of your venues, you'll be told here and by email, and you can answer it."
        />
      )}

      {open.map((claim) => (
        <OpenClaim key={claim.claim} claim={claim} />
      ))}

      {answered.length > 0 && (
        <Card title="Decided recently">
          <ul aria-label="Decided claims" className="divide-y divide-ink-100">
            {answered.map((claim) => (
              <li key={claim.claim} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900">{claim.venueName}</p>
                  <p className="text-sm text-ink-500">{outcome(claim)}</p>
                </div>
                <Badge tone={OUTCOME_TONE[claim.status]}>{OUTCOME_LABEL[claim.status] || claim.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

const OUTCOME_LABEL = {
  Granted: 'Moved',
  Declined: 'Claim declined',
  Withdrawn: 'Withdrawn',
  Revoked: 'Reversed',
}

const OUTCOME_TONE = {
  Granted: 'Declined',
  Declined: 'Approved',
  Withdrawn: 'Draft',
  Revoked: 'Approved',
}

/** What the decision means for THIS partner, which is not what it meant for the claimant. */
function outcome(claim) {
  if (claim.status === 'Granted') {
    return claim.venueIsYours
      ? 'The claim was approved.'
      : 'The claimant proved ownership and the venue moved to their account. Reply to the email we sent if you think that is wrong.'
  }
  if (claim.status === 'Declined') return 'The claim was declined. Nothing about the venue changed.'
  if (claim.status === 'Withdrawn') return 'The claimant withdrew it. Nothing about the venue changed.'
  if (claim.status === 'Revoked') return 'An earlier decision was reversed.'
  return ''
}

function OpenClaim({ claim }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(claim.response)
  const [saved, setSaved] = useState(false)

  const respond = useMutation({
    mutationFn: () => respondToClaim({ claim: claim.claim, response: draft }),
    onSuccess: (updated) => {
      setSaved(true)
      queryClient.setQueryData(ON_MY_VENUES_QUERY, (rows) =>
        (rows || []).map((row) => (row.claim === updated.claim ? updated : row)),
      )
    },
  })

  const tooLong = draft.trim().length > MAX_RESPONSE_CHARS
  const unchanged = draft.trim() === claim.response.trim()

  return (
    <Card title={claim.venueName}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="Pending">Under review</Badge>
          <p className="text-sm text-ink-500">
            Filed {formatDay(claim.filedAt)}
            {claim.role ? ` by someone claiming to be the ${claim.role.toLowerCase()}` : ''}.
          </p>
        </div>

        <Alert variant="warning">
          Nothing has changed yet. {claim.venueName} is still yours, guests can still find and book it, and no venue
          moves until a reviewer has read your answer. We don&rsquo;t share who made the claim, and they don&rsquo;t
          see what you send.
        </Alert>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSaved(false)
            respond.mutate()
          }}
        >
          <Textarea
            label="Your response"
            aria-label="Your response"
            rows={5}
            value={draft}
            placeholder="Tell us why this venue is yours — how long you've run it, whose name is on the lease or licence, anything that helps."
            onChange={(event) => {
              setDraft(event.target.value)
              setSaved(false)
            }}
            error={tooLong ? `Keep it under ${MAX_RESPONSE_CHARS} characters. Add documents for anything longer.` : undefined}
          />
          <Alert variant="danger">{respond.error?.message}</Alert>
          <Alert variant="success">{saved ? 'Your response has been sent to the reviewer.' : null}</Alert>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!draft.trim() || tooLong || unchanged || respond.isPending}>
              {respond.isPending ? 'Sending…' : claim.responded ? 'Update response' : 'Send response'}
            </Button>
            {claim.responded && claim.respondedAt && (
              <span className="text-xs text-ink-500">Last sent {formatDay(claim.respondedAt)}</span>
            )}
          </div>
        </form>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink-900">Your documents</h3>
          <p className="text-sm text-ink-500">
            Anything with the business&rsquo;s name on it: a registration document, a liquor licence, a lease, a utility
            bill. PDF or a photo, up to {MAX_EVIDENCE_MB} MB each, {MAX_EVIDENCE_FILES} at most. Only reviewers see them.
          </p>
          <ResponseEvidence claim={claim} />
        </div>
      </div>
    </Card>
  )
}

/** The owner's own documents on one claim. Never the claimant's. */
function ResponseEvidence({ claim }) {
  const queryClient = useQueryClient()
  const inputRef = useRef(null)

  const store = (evidence) =>
    queryClient.setQueryData(ON_MY_VENUES_QUERY, (rows) =>
      (rows || []).map((row) => (row.claim === claim.claim ? { ...row, evidence } : row)),
    )

  const add = useMutation({ mutationFn: (file) => uploadResponseEvidence(claim.claim, file), onSuccess: store })
  const remove = useMutation({ mutationFn: (fileId) => removeResponseEvidence(claim.claim, fileId), onSuccess: store })

  const rows = claim.evidence
  const full = rows.length >= MAX_EVIDENCE_FILES

  const onPick = async (event) => {
    // One at a time, so the bench's limit refuses the seventh with its own
    // message rather than racing six uploads.
    const picked = Array.from(event.target.files || [])
    event.target.value = ''
    for (const file of picked) {
      try {
        await add.mutateAsync(file)
      } catch {
        break
      }
    }
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <ul
          aria-label={`Your documents for ${claim.venueName}`}
          className="divide-y divide-ink-100 rounded-2xl ring-1 ring-ink-100"
        >
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate text-ink-900">{row.name}</span>
              <button
                type="button"
                className="shrink-0 text-xs font-semibold text-red-700 hover:underline"
                aria-label={`Remove ${row.name}`}
                onClick={() => remove.mutate(row.id)}
                disabled={remove.isPending}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <Alert variant="danger">{add.error?.message || remove.error?.message}</Alert>
      <input
        ref={inputRef}
        type="file"
        accept={EVIDENCE_ACCEPT}
        multiple
        className="sr-only"
        aria-label={`Add a document for ${claim.venueName}`}
        onChange={onPick}
        tabIndex={-1}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={full || add.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {add.isPending ? 'Uploading…' : full ? `${MAX_EVIDENCE_FILES} documents added` : 'Add a document'}
      </Button>
    </div>
  )
}

function formatDay(value) {
  const date = new Date(String(value || '').replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? 'recently'
    : date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

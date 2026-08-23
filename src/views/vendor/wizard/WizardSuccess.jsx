import { Link } from 'react-router-dom'
import { Button, Alert } from '../../../components/ui'
import { inBucket } from '../../../services/workflowState'

/**
 * Shown after SUBMIT (`venue added success.png`) — but what it SAYS depends on
 * what actually happened, because since the 22 Aug submission gate "created"
 * and "sent for review" are two different events and only one of them is
 * guaranteed by reaching this screen.
 *
 * Outcomes, in order of what the partner needs to hear first:
 *  - QUEUED: created and submitted; the old copy, now true again.
 *  - REFUSED: created, but the completeness rules sent it to Declined with
 *    reasons. The listing is safe; the reasons are shown ALL AT ONCE (the
 *    backend returns them as a list for exactly this) with the way forward.
 *  - NOT ASKED / FAILED: created, but the submission call itself could not
 *    run (endpoint missing, network). Saying "sent to our team" over that
 *    would promise a review that will never happen — the venue would sit in
 *    Draft for ever with the partner none the wiser.
 *
 * The promise of a follow-up call in the QUEUED copy is deliberate, not
 * filler — the 360° venue tour needs someone to visit the venue, and the
 * designs set that expectation here. Do not soften it without also changing
 * whatever ops process backs it.
 */
export default function WizardSuccess({
  venueName,
  venueId,
  warnings = [],
  review,
  onAddAnother,
}) {
  const refused = (review?.blockers?.length ?? 0) > 0
  const queued = !refused && review?.asked !== false && !review?.failed &&
    (review?.workflow_state === undefined || inBucket({ workflow_state: review.workflow_state }, 'pending') || inBucket({ workflow_state: review.workflow_state }, 'approved'))
  const marks = review?.marks ?? []
  const name = venueName ? <strong>{venueName}</strong> : 'Your business profile'

  return (
    <div className="rounded-3xl border border-brand-300 bg-white p-10 text-center">
      <span
        className={`mx-auto grid size-16 place-items-center rounded-full ${queued ? 'bg-green-50' : 'bg-amber-50'}`}
      >
        {queued ? (
          <svg viewBox="0 0 20 20" className="size-9 fill-green-500">
            <path d="M10 0a10 10 0 100 20 10 10 0 000-20zm4.7 7.7l-5.4 5.4a1 1 0 01-1.4 0L5.3 10.5a1 1 0 111.4-1.4l1.9 1.9 4.7-4.7a1 1 0 111.4 1.4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" className="size-9 fill-amber-500">
            <path d="M10 0a10 10 0 100 20 10 10 0 000-20zm0 5a1 1 0 011 1v5a1 1 0 11-2 0V6a1 1 0 011-1zm0 10.5a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
          </svg>
        )}
      </span>

      {queued ? (
        <>
          <h1 className="mt-5 text-2xl font-bold text-ink-900">Chisa! You&rsquo;re all set</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-700">
            {name} has been successfully created and sent to our team for review.
          </p>
          <p className="mx-auto mt-4 max-w-md text-sm text-ink-700">
            A Bloop representative will contact you to set up your venue&rsquo;s visual tour. Until
            the review is done you&rsquo;ll find this venue under <strong>Pending</strong>.
          </p>
          {/* Thin-but-reviewable notes. Advisory by design: the listing IS in
              the queue, so these must read as "worth doing", never as errors. */}
          {marks.length > 0 && (
            <div className="mx-auto mt-6 max-w-lg space-y-2 text-left">
              {marks.map((m) => (
                <Alert key={m.code || m.message} variant="info">
                  {m.message}
                </Alert>
              ))}
            </div>
          )}
        </>
      ) : refused ? (
        <>
          <h1 className="mt-5 text-2xl font-bold text-ink-900">
            Saved — but not ready for review yet
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-700">
            {name} has been created and nothing you entered is lost. Before our team can look at
            it, it needs:
          </p>
          <div className="mx-auto mt-4 max-w-lg space-y-2 text-left">
            {review.blockers.map((b) => (
              <Alert key={b.code || b.message} variant="warning">
                {b.message}
              </Alert>
            ))}
          </div>
          <p className="mx-auto mt-4 max-w-md text-sm text-ink-700">
            Add what&rsquo;s missing and submit it again — you&rsquo;ll find it under{' '}
            <strong>Declined</strong> until then.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-5 text-2xl font-bold text-ink-900">Created and saved</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-700">
            {name} has been created and everything you entered is safe — but we couldn&rsquo;t
            send it to our team for review just now. You&rsquo;ll find it under{' '}
            <strong>Drafts</strong> in My venues; submit it from there when you&rsquo;re ready.
          </p>
        </>
      )}

      {/* Anything the backend could not accept is said plainly here. A partner
          who typed a mood or set public-holiday hours must not be left assuming
          it saved — a silent drop is worse than an inconvenient truth. */}
      {warnings.length > 0 && (
        <div className="mx-auto mt-6 max-w-lg space-y-2 text-left">
          {warnings.map((w) => (
            <Alert key={w} variant="warning">
              {w}
            </Alert>
          ))}
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        {refused && venueId && (
          <Link to={`/venues/${venueId}/edit`}>
            <Button>Finish the listing</Button>
          </Link>
        )}
        <Button variant="secondary" onClick={onAddAnother}>
          Add another venue
        </Button>
        <Link to="/">
          <Button variant={refused ? 'secondary' : 'primary'}>Go to dashboard</Button>
        </Link>
      </div>
    </div>
  )
}

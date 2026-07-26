import { Link } from 'react-router-dom'
import { Button } from '../../../components/ui'

/**
 * Shown after SUBMIT (`venue added success.png`).
 *
 * The promise of a follow-up call is deliberate, not filler — the 360° venue
 * tour needs someone to visit the venue, and the designs set that expectation
 * here. Do not soften it without also changing whatever ops process backs it.
 */
export default function WizardSuccess({ venueName, onAddAnother }) {
  return (
    <div className="rounded-3xl border border-brand-300 bg-white p-10 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-green-50">
        <svg viewBox="0 0 20 20" className="size-9 fill-green-500">
          <path d="M10 0a10 10 0 100 20 10 10 0 000-20zm4.7 7.7l-5.4 5.4a1 1 0 01-1.4 0L5.3 10.5a1 1 0 111.4-1.4l1.9 1.9 4.7-4.7a1 1 0 111.4 1.4z" />
        </svg>
      </span>

      <h1 className="mt-5 text-2xl font-bold text-ink-900">Chisa! You&rsquo;re all set</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-700">
        {venueName ? <strong>{venueName}</strong> : 'Your business profile'} has been successfully
        created and sent to our team for review.
      </p>
      <p className="mx-auto mt-4 max-w-md text-sm text-ink-700">
        A Bloop representative will contact you to set up your venue&rsquo;s visual tour. Until the
        review is done you&rsquo;ll find this venue under <strong>Pending</strong>.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Button variant="secondary" onClick={onAddAnother}>
          Add another venue
        </Button>
        <Link to="/">
          <Button>Go to dashboard</Button>
        </Link>
      </div>
    </div>
  )
}

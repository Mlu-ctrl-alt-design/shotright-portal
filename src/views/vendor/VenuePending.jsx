import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Badge, Button, Card } from '../../components/ui'
import { deriveSections, getReviewSections, sectionTally, submittedAt } from '../../services/venueProgress'

/**
 * "Where this venue stands" — the waiting screen.
 *
 * A partner who has submitted a venue is doing the one thing this product asks
 * of them that they have no control over. They cannot make it go faster and
 * they cannot see inside it. The only useful things a screen can do are: say
 * what is actually known, say what is not known rather than implying it, and
 * give them something to get on with.
 *
 * WHAT THIS SCREEN REFUSES TO SAY, AND WHY EACH ONE IS ABSENT:
 *
 * 1. "Approved" against any individual section. Per-section review does not
 *    exist on the bench. Our checklist is about what YOU have filled in, and it
 *    is labelled that way, in the heading, in the badges, and in a sentence
 *    directly under the heading. Four green "Approved" badges would tell
 *    someone they are nearly live when nobody has looked yet.
 *
 * 2. "Usually approved within 2 working days." Nobody has committed to a
 *    turnaround. That number is a promise the business makes, not a string the
 *    frontend picks, and a partner who stops checking because of an invented
 *    SLA is worse off than one who was told nothing.
 *
 * 3. "We'll email you either way, so there's no need to check back." Outgoing
 *    mail (§8) is not configured. This is the third place that sentence has
 *    been caught on this project; it is not going in a fourth.
 *
 * Every one of them turns on by itself when the data arrives — `submitted_on`,
 * a turnaround figure, `will_notify`, a per-section endpoint. None needs a
 * frontend release. That is the point of building it this way rather than
 * waiting for the backend and shipping the mock as drawn.
 */
export default function VenuePending({ venue, venueId, photos = [], menu = [] }) {
  const { data: reviewed } = useQuery({
    queryKey: ['venue-review-sections', venueId],
    queryFn: () => getReviewSections(venueId),
    enabled: !!venueId,
  })

  const ours = deriveSections(venue, { photos, menu })
  const theirs = reviewed?.available ? reviewed.sections : null
  const sections = theirs || ours
  const tally = sectionTally(ours)
  const when = submittedAt(venue)

  const outstanding = ours.filter((s) => s.state !== 'done')

  return (
    <div className="space-y-6">
      <Card title="With our team">
        <p className="text-sm text-ink-700">
          {venue?.venue_name} is in the queue for review. Nothing more is needed from you for it to
          be looked at.
        </p>

        {/* The date, labelled by what we can actually stand behind. `creation`
            is when the record was made; on a resubmit that is not when it was
            submitted, which is why the word changes with the field and why no
            duration is computed from either. */}
        {when && (
          <p className="mt-3 text-sm text-ink-700">
            {when.exact ? 'Submitted' : 'Added'}{' '}
            <strong>
              {new Date(when.date).toLocaleDateString('en-ZA', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </strong>
            .
          </p>
        )}

        {/* No turnaround, and said out loud rather than left as an absence a
            partner has to notice. Someone who knows we can't tell them will
            check back; someone who thinks we forgot to mention it will wait. */}
        <p className="mt-3 text-sm text-ink-700">
          We can’t give you a turnaround time yet — we’d rather say that than put up a number
          nobody has stood behind. <strong>The decision appears on this page</strong>, so it’s
          worth coming back to.
        </p>
      </Card>

      <Card
        title={theirs ? 'What we’re still checking' : 'What’s in your listing'}
        action={
          theirs ? null : (
            <span className="text-xs text-ink-500">
              {tally.done} of {tally.total} complete
            </span>
          )
        }
      >
        {/* THE SENTENCE THAT KEEPS THE TABLE HONEST. Without it, a column of
            green badges reads as a column of approvals. It goes above the list,
            not below it, because it changes how every row beneath is read. */}
        {!theirs && (
          <p className="mb-4 text-sm text-ink-700">
            This is what <strong>you’ve</strong> given us — not what our team has signed off. They
            review the venue as a whole, and we’ll show their decision here when it comes.
          </p>
        )}

        <ul className="divide-y divide-gray-200">
          {sections.map((section) => (
            <li key={section.key} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink-900">{section.label}</p>
                {section.detail && (
                  <p className="mt-0.5 text-sm text-ink-700">{section.detail}</p>
                )}
                {section.blockedOn && (
                  <p className="mt-0.5 text-sm text-ink-700">Waiting on {section.blockedOn}.</p>
                )}
                {!theirs && section.state !== 'done' && (
                  <Link
                    to={section.to === 'menu' ? `/venues/${venueId}/menu` : `/venues/${venueId}/edit`}
                    className="mt-1 inline-block text-sm font-bold text-brand-ink underline underline-offset-2"
                  >
                    {section.state === 'partial' ? 'Finish this' : 'Add this'} →
                  </Link>
                )}
              </div>
              <SectionBadge section={section} derived={!theirs} />
            </li>
          ))}
        </ul>
      </Card>

      {/* Something to do with the waiting. Only shown when there is genuinely
          something — an empty "you could improve these" card on a complete
          listing is busywork dressed as advice. */}
      {!theirs && outstanding.length > 0 && (
        <Card title="Worth doing while you wait">
          <p className="text-sm text-ink-700">
            None of this stops the review — your venue is being looked at either way. But a listing
            with these filled in is a listing people choose.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to={`/venues/${venueId}/edit`}>
              <Button variant="secondary">Edit this venue</Button>
            </Link>
            <Link to={`/venues/${venueId}/menu`}>
              <Button variant="secondary">Work on the menu</Button>
            </Link>
          </div>
        </Card>
      )}

      <p className="text-xs text-ink-500">
        Reference for this venue: <code className="font-mono">{venueId}</code>
      </p>
    </div>
  )
}

/**
 * The badge.
 *
 * Two vocabularies that must never be confused, so they are two branches rather
 * than one lookup with a flag. Ours says whether something is filled in; the
 * bench's says what a reviewer decided. An unrecognised state from the bench is
 * shown verbatim — the same rule as `workflowState.js`, for the same reason:
 * their word is what lets someone spot the mismatch.
 */
function SectionBadge({ section, derived }) {
  if (!derived) {
    return <Badge tone={/approv|pass|clear/i.test(section.state) ? 'Approved' : 'Pending'}>
      {section.state || '—'}
    </Badge>
  }

  const LABELS = { done: 'Added', partial: 'Partly done', missing: 'Not added' }
  const TONES = { done: 'Approved', partial: 'Pending', missing: 'Draft' }
  return <Badge tone={TONES[section.state]}>{LABELS[section.state]}</Badge>
}

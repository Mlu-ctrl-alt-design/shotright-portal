import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useVenue, useMenu, useVenuePhotos } from '../../hooks/useVendor'
import { isMethodMissing } from '../../services/api'
import { VENUE_DETAIL_METHOD } from '../../services/vendor'
import VenuePending from './VenuePending'
import { Alert, Badge, Button, Card } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { bucketOf, stateLabel, stateTone } from '../../services/workflowState'
import {
  contactSupport,
  deriveGaps,
  getVenueReview,
  localFixState,
  setFixItemDone,
  supportMailto,
} from '../../services/venueReview'

/**
 * "Your venue wasn't approved" — and what to do next.
 *
 * This is the only screen in the portal where the partner is not the one
 * driving. They submitted a venue, waited days, and were told no by somebody
 * they have never spoken to. Everything here answers one question: *why, and
 * what do I change?*
 *
 * THE ORDER IS THE ARGUMENT. The reviewer's own words come first and unedited,
 * because the partner came here to read them and anything above that is us
 * talking over the person they wanted to hear from. Then the checklist, then
 * what we noticed ourselves, then the two ways out.
 *
 * WHAT WE DO NOT DO. When a decline genuinely arrives with no note attached,
 * the tempting fix is a neutral placeholder — "your venue didn't meet our
 * guidelines" — and it is a trap: a partner acts on it, changes the wrong
 * thing, resubmits, and is declined again. We say there is no reason, we say we
 * consider that our problem and not theirs, and we make asking a human the
 * primary action rather than the fallback.
 *
 * Corrected 28 Jul: this screen used to show that empty state to EVERYONE,
 * because it asked an undeployed endpoint for notes the venue record was
 * already carrying. It now reads the record first. The empty state below is
 * still exactly right — it just applies to the venues it was written for, the
 * ones where a moderator really did decline without saying why.
 */
export default function VenueReview() {
  const { venueId } = useParams()
  const { data: venue, isLoading, error } = useVenue(venueId)
  const { data: menuData } = useMenu(venueId)
  const { data: photoData } = useVenuePhotos(venueId)

  // The venue is handed to the review reader deliberately: `review_notes`,
  // `reviewed_by` and `reviewed_on` ride along on the venue record, so in the
  // ordinary case there is no second round trip and nothing to deploy. Gated on
  // `venue` so this can't run against nothing and cache a false "no reason".
  const { data: reviewData, isLoading: loadingReview } = useQuery({
    queryKey: ['venue-review', venueId],
    queryFn: () => getVenueReview(venueId, venue),
    enabled: Boolean(venueId && venue),
  })

  // A failed read of the notes must not take the page down with it. The gaps we
  // derive ourselves, the edit route and the way to reach a human all still
  // work without it, and they are most of what someone came here for.
  const review = reviewData || {
    available: false,
    source: 'none',
    notes: '',
    fixItems: [],
    reviewedOn: '',
  }

  if (isLoading || (venue && loadingReview)) return <Spinner label="Loading this decision…" />
  if (error) {
    return (
      <div className="space-y-4">
        {/* This branch is now genuinely rare — `getVenue` falls back to the
            dashboard row, so a 404 from `get_venue_detail` no longer lands
            here. What used to land here was the live bug: a partner clicked
            "See why" on their own declined venue and was told it wasn't on
            their account.

            The remaining case still has to be split. A 404 from Frappe is the
            SAME status for a missing method and a missing document, and only
            the exception text tells them apart. Guessing "your venue is gone"
            when the truth is "that endpoint isn't deployed" is the most
            alarming possible way to report our own gap. */}
        <Alert variant="danger">
          <p className="font-bold">We couldn’t open this venue</p>
          <p className="mt-1">
            {isMethodMissing(error, VENUE_DETAIL_METHOD)
              ? 'We can’t open this venue right now. Nothing has happened to it — please try again shortly.'
              : error.status === 404
                ? 'It isn’t on the account you’re signed in with, or it has been removed.'
                : error.status === 403
                  ? 'This venue belongs to a different account.'
                  : error.message}
          </p>
        </Alert>
        <Link to="/venues">
          <Button variant="secondary">Back to your venues</Button>
        </Link>
      </div>
    )
  }

  const bucket = bucketOf(venue?.workflow_state)
  const declined = bucket === 'declined'
  const gaps = deriveGaps(venue, {
    photos: photoData?.photos || [],
    menu: menuData?.headings || [],
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink-700">{venue?.venue_name}</p>
          <h1 className="mt-0.5 text-2xl font-bold text-ink-900">
            {declined ? 'This venue wasn’t approved' : 'Where this venue stands'}
          </h1>
        </div>
        <Badge tone={stateTone(venue?.workflow_state)}>{stateLabel(venue?.workflow_state)}</Badge>
      </div>

      {/* Pending gets a screen of its own rather than a one-line alert. It is
          the state a venue spends the most time in and the one where a partner
          has the least to go on — a sentence saying "with our team" answers the
          question they already knew the answer to. */}
      {bucket === 'pending' && (
        <VenuePending
          venue={venue}
          venueId={venueId}
          photos={photoData?.photos || []}
          menu={menuData?.headings || []}
        />
      )}

      {/* Approved, or a state no bucket claims — reached from a bookmark, or a
          link sent before the venue was resubmitted. Saying which state it IS
          in beats a screen that argues with what the badge says. */}
      {!declined && bucket !== 'pending' && (
        <Alert variant={bucket === 'approved' ? 'success' : 'info'}>
          {bucket === 'approved'
            ? 'This venue is approved and showing to customers. Nothing to fix.'
            : 'This venue is with our team. The decision shows up on this page — check back here for it.'}
        </Alert>
      )}

      {declined && <WhatTheReviewerSaid review={review} />}

      {declined && review.fixItems.length > 0 && (
        <FixList venueId={venueId} items={review.fixItems} />
      )}

      {declined && gaps.length > 0 && <WhatWeNoticed gaps={gaps} venueId={venueId} />}

      {declined && <Next venue={venue} venueId={venueId} review={review} />}
    </div>
  )
}

/* ------------------------------------------------------------------------ */

function WhatTheReviewerSaid({ review }) {
  const when = review.reviewedOn
    ? new Date(review.reviewedOn).toLocaleDateString('en-ZA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  if (!review.notes) {
    return (
      <Card title="Why this was declined">
        <p className="text-sm font-bold text-ink-900">No reason was recorded.</p>
        <p className="mt-2 text-sm text-ink-700">
          That isn’t good enough, and it isn’t something you did — a decision came back without a
          note attached to it. Please ask us directly rather than guessing: we can tell you exactly
          what needs to change, and you shouldn’t have to resubmit twice to find out.
        </p>
        {/* Named precisely, so this reaches whoever owns the bench rather than
            evaporating into "the portal is broken". Kept quiet and factual —
            the partner does not need to care whose fault it is, only that it
            isn't theirs. */}
        {review.available === false && (
          <p className="mt-3 text-xs text-ink-500">
            We can’t load the reviewer’s note right now.
          </p>
        )}
      </Card>
    )
  }

  return (
    <Card title="Why this was declined">
      {/* The reviewer's words, unedited and visually set apart, because the
          partner came to this page to read exactly this and nothing else on
          the screen should be able to be mistaken for it. */}
      <blockquote className="border-l-4 border-brand-500 pl-4 text-sm leading-relaxed whitespace-pre-line text-ink-900">
        {review.notes}
      </blockquote>
      {(review.reviewedBy || when) && (
        <p className="mt-3 text-xs text-ink-500">
          {review.reviewedBy ? `${review.reviewedBy}` : 'Sho’t Right team'}
          {when ? ` · ${when}` : ''}
        </p>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------------ */

/**
 * The reviewer's checklist.
 *
 * Ticking is the partner's own working memory — it is stored, but it is NOT
 * sent to the reviewer and the copy says so. A checkbox that looks like it
 * reports progress to somebody, and doesn't, is a promise the screen cannot
 * keep; and a partner who believes they have told us they fixed something will
 * wait for a response that is never coming.
 */
function FixList({ venueId, items }) {
  const [done, setDone] = useState(() => {
    const local = localFixState(venueId)
    return Object.fromEntries(items.map((i) => [i.key, local[i.key] ?? i.done]))
  })
  const [announcement, setAnnouncement] = useState('')

  const toggle = async (item) => {
    const next = !done[item.key]
    setDone((d) => ({ ...d, [item.key]: next }))
    setAnnouncement(
      `${item.label} — ${next ? 'ticked' : 'unticked'}. ${
        Object.values({ ...done, [item.key]: next }).filter(Boolean).length
      } of ${items.length} done.`,
    )
    try {
      await setFixItemDone(venueId, item.key, next)
    } catch {
      // The tick is a note to self. Failing to persist it must not throw the
      // partner out of a screen they are reading for a reason.
    }
  }

  const total = items.length
  const complete = items.filter((i) => done[i.key]).length

  return (
    <Card title="What to fix" action={<span className="text-xs text-ink-500">{complete} of {total}</span>}>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.key}>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={Boolean(done[item.key])}
                onChange={() => toggle(item)}
                className="mt-0.5 size-4 shrink-0 accent-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              />
              <span
                className={
                  done[item.key] ? 'text-sm text-ink-500 line-through' : 'text-sm text-ink-900'
                }
              >
                {item.label}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink-500">
        Ticking these is just for you — it keeps your place while you work through them. Our team
        sees the venue itself when you resubmit, not this list.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </Card>
  )
}

/* ------------------------------------------------------------------------ */

/**
 * Gaps we can see for ourselves.
 *
 * Under its own heading, with its own disclaimer, because the one thing this
 * section must never do is get mistaken for the reviewer's reasons. A partner
 * who fixes our five observations and resubmits, when the reviewer declined
 * them over something else entirely, has been sent on an errand by their own
 * software.
 *
 * It earns its place anyway: when no note was left, this is the only concrete
 * thing on the page.
 */
function WhatWeNoticed({ gaps, venueId }) {
  return (
    <Card title="Things we noticed">
      <p className="text-sm text-ink-700">
        These aren’t the reviewer’s reasons — they’re gaps we can see in your listing. Worth
        checking either way.
      </p>
      <ul className="mt-4 space-y-4">
        {gaps.map((gap) => (
          <li key={gap.key} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500"
            />
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-900">{gap.label}</p>
              <p className="mt-0.5 text-sm text-ink-700">{gap.detail}</p>
              <Link
                to={gap.to === 'menu' ? `/venues/${venueId}/menu` : `/venues/${venueId}/edit`}
                className="mt-1 inline-block text-sm font-bold text-brand-ink underline underline-offset-2"
              >
                {gap.to === 'menu' ? 'Add menu items' : 'Fix this'} →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ------------------------------------------------------------------------ */

function Next({ venue, venueId, review }) {
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const noReason = !review.notes

  const mailto = supportMailto({
    venueName: venue?.venue_name,
    venueId,
    reviewedOn: review.reviewedOn,
    message,
  })

  // `contact_support` is deployed, so this is a real send rather than a handoff
  // to the partner's mail app. What it must never do is claim delivery it can't
  // prove — see contactSupport(). An unconfirmed send keeps their words on the
  // screen and offers the mailto beside it.
  const send = async () => {
    setSending(true)
    setResult(null)
    try {
      setResult(await contactSupport({ venueId, venueName: venue?.venue_name, message }))
    } finally {
      setSending(false)
    }
  }

  const canReach = Boolean(mailto) || result?.reason !== 'not-deployed'

  // With no reason to act on, "edit and resubmit" is an invitation to guess.
  // Asking becomes the primary action and editing the secondary one — the same
  // two buttons, weighted to whichever is actually the better move.
  const editFirst = !noReason

  const edit = (
    <Link to={`/venues/${venueId}/edit`}>
      <Button variant={editFirst ? 'primary' : 'secondary'}>Edit and resubmit</Button>
    </Link>
  )

  return (
    <Card title="What happens next">
      <p className="text-sm text-ink-700">
        Editing this venue sends it straight back to our team for another look. Nothing you&rsquo;ve
        already entered is lost.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {editFirst && edit}

        {/* Shown unconditionally now. It used to depend on VITE_SUPPORT_EMAIL,
            which nobody ever sent us, so the primary action on a screen with no
            reason on it was missing entirely. `contact_support` is deployed;
            if it turns out to be absent on some bench, the panel says so at the
            point of sending rather than hiding the button before anyone asks. */}
        <Button
          variant={editFirst ? 'secondary' : 'primary'}
          onClick={() => setAsking((v) => !v)}
          aria-expanded={asking}
        >
          Contact support
        </Button>

        {!editFirst && edit}
      </div>

      {asking && (
        <div className="mt-5 rounded-2xl bg-tint p-5">
          <label htmlFor="support-message" className="block text-sm font-bold text-ink-900">
            What would you like to ask?
          </label>
          <textarea
            id="support-message"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              noReason
                ? 'I’d like to know why this venue was declined, and what to change.'
                : 'Tell us what you’d like help with.'
            }
            className="mt-2 block w-full rounded-2xl border-2 border-field bg-white px-4 py-3 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-edge focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={send} loading={sending} disabled={!message.trim()}>
              Send to the Sho’t Right team
            </Button>
            {/* The mailto stays as a second route, not the only one. A real
                link rather than a scripted window.location: right-clickable,
                opens in their own mail app, and shows where it goes first. */}
            {mailto && (
              <Button as="a" variant="secondary" href={mailto}>
                Open my email instead
              </Button>
            )}
            <p className="text-xs text-ink-500">
              We&rsquo;ll attach this venue&rsquo;s name and reference so you don&rsquo;t have to.
            </p>
          </div>

          {/* Three outcomes, three different things to say. The one that matters
              is the middle one: the server took the message but told us nothing
              back, so we cannot honestly say it arrived. The partner's words
              stay on screen and the other route stays open. */}
          {result?.confirmed && (
            <Alert variant="success" className="mt-4">
              Sent. We&rsquo;ll reply by email
              {result.reference ? (
                <>
                  {' '}
                  — your reference is{' '}
                  <code className="font-mono text-xs">{result.reference}</code>
                </>
              ) : null}
              .
            </Alert>
          )}

          {result?.sent && !result.confirmed && (
            <Alert variant="warning" className="mt-4">
              <p className="font-bold">We couldn’t confirm that went through</p>
              <p className="mt-1">
                The server accepted it but didn&rsquo;t acknowledge it, so we&rsquo;re not going
                to tell you it arrived. Your message is still in the box above —{' '}
                {mailto ? 'send it by email as well, to be safe.' : 'please keep a copy.'} Quote{' '}
                <code className="font-mono text-xs">{venueId}</code>.
              </p>
            </Alert>
          )}

          {result?.reason === 'not-deployed' && (
            <Alert variant="warning" className="mt-4">
              <p className="font-bold">This isn’t wired up on your server yet</p>
              <p className="mt-1">
                {mailto
                  ? 'Use “Open my email instead” — it carries the same details.'
                  : `Nothing here can reach our team yet. Use whichever contact you already have for the Sho’t Right team, and quote ${venueId}.`}
              </p>
            </Alert>
          )}

          {result?.reason === 'error' && (
            <Alert variant="danger" className="mt-4">
              That didn&rsquo;t send — {result.error?.message || 'something went wrong.'} Your
              message is still above.
            </Alert>
          )}
        </div>
      )}

      {/* The reference, always visible.
          It used to appear only inside the "we have no support address" notice,
          which disappeared when contact_support landed — taking with it the one
          string a partner needs when they reach us by any route we don't
          control, which in South Africa is usually WhatsApp or a phone call.
          It belongs on the page in its own right, not as a consolation prize
          for a broken button. */}
      <p className="mt-5 text-xs text-ink-500">
        Reference for this venue: <code className="font-mono">{venueId}</code>
        {canReach ? '' : ' — use whichever contact you already have for the Sho’t Right team.'}
      </p>
    </Card>
  )
}

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Card, EmptyState, Textarea } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import {
  MAX_REPLY_LENGTH,
  RATINGS_MAX_PAGE,
  RATINGS_PAGE,
  getVenueRatings,
  replyToRating,
} from '../../services/ratings'

/**
 * What customers said after their visit, and the one reply the venue gets.
 *
 * Every rating here comes from a real booking at this venue — the app only
 * asks customers who booked, from 3 hours to 14 days after their table. So a
 * low score is a real guest's evening, and the reply is to that guest: they
 * see it in the app, and are told about it the first time one is saved.
 */

const DATE = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

const dateLabel = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number)
  return y && m && d ? DATE.format(new Date(y, m - 1, d)) : ''
}

function Stars({ score }) {
  return (
    <span aria-label={`${score} out of 5`} className="tracking-tight text-brand-500">
      {'★'.repeat(score)}
      <span className="text-ink-200">{'★'.repeat(5 - score)}</span>
    </span>
  )
}

function ReplyForm({ rating, onDone }) {
  const queryClient = useQueryClient()
  const { venueId } = useParams()
  const [text, setText] = useState(rating.reply)

  const save = useMutation({
    mutationFn: () => replyToRating(rating.id, text.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ratings', venueId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onDone()
    },
  })

  const trimmed = text.trim()
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed) save.mutate()
      }}
    >
      <Alert variant="danger">{save.error?.message}</Alert>
      <Textarea
        label={`Your reply to ${rating.firstName || 'this guest'}`}
        value={text}
        maxLength={MAX_REPLY_LENGTH}
        onChange={(e) => setText(e.target.value)}
        placeholder="Thank them, or tell them what you’ve done about it."
      />
      <p className="text-xs text-ink-500">
        {rating.reply
          ? 'Saving replaces your earlier reply.'
          : 'They’ll see this in the app, and we’ll let them know you replied.'}{' '}
        {text.length}/{MAX_REPLY_LENGTH}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={save.isPending} disabled={!trimmed}>
          {save.isPending ? 'Saving…' : 'Save reply'}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function RatingRow({ rating }) {
  const [replying, setReplying] = useState(false)

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <Stars score={rating.score} />
          <span className="text-sm font-bold text-ink-900">{rating.firstName || 'A guest'}</span>
        </div>
        {rating.visitDate && (
          <span className="text-xs text-ink-500">Visited {dateLabel(rating.visitDate)}</span>
        )}
      </div>

      {rating.flagged ? (
        <p className="mt-2 text-sm text-ink-500 italic">
          Hidden by Sho’t Right for breaking our guidelines. It doesn’t count towards your
          average and can’t be replied to.
        </p>
      ) : (
        rating.comment && <p className="mt-2 text-sm text-ink-900">“{rating.comment}”</p>
      )}

      {!rating.flagged && rating.reply && !replying && (
        <div className="mt-3 rounded-2xl bg-canvas px-4 py-3">
          <p className="text-xs font-semibold text-ink-700">
            Your reply{rating.repliedOn ? ` · ${dateLabel(rating.repliedOn)}` : ''}
          </p>
          <p className="mt-1 text-sm text-ink-900">{rating.reply}</p>
        </div>
      )}

      {!rating.flagged &&
        (replying ? (
          <ReplyForm rating={rating} onDone={() => setReplying(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="mt-2 text-sm font-semibold text-brand-700 underline underline-offset-2"
          >
            {rating.reply ? 'Edit reply' : 'Reply'}
          </button>
        ))}
    </li>
  )
}

function Summary({ data }) {
  if (!data.count) return null
  return (
    <div className="mb-2 flex flex-wrap items-end gap-x-6 gap-y-1">
      <p className="text-3xl font-bold text-ink-900 tabular-nums">
        {Number(data.average).toFixed(1)}
        <span className="ml-1 text-base font-semibold text-ink-500">/ 5</span>
      </p>
      <p className="text-sm text-ink-700">
        from {data.count} {data.count === 1 ? 'rating' : 'ratings'}
      </p>
    </div>
  )
}

export default function VenueRatings() {
  const { venueId } = useParams()
  const [showing, setShowing] = useState('all')
  const [limit, setLimit] = useState(RATINGS_PAGE)
  const unrepliedOnly = showing === 'unreplied'

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['ratings', venueId, showing, limit],
    queryFn: () => getVenueRatings(venueId, { limit, unrepliedOnly }),
    enabled: !!venueId,
    placeholderData: (previous) => previous,
  })

  if (isLoading) return <Spinner label="Loading ratings…" />

  if (data?.errored) {
    return (
      <Card title="Ratings">
        <Alert variant="warning">
          <p className="font-bold">We couldn’t load your ratings just now</p>
          <p className="mt-1">This is on our side. Please try again.</p>
        </Alert>
        <Button className="mt-4" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Trying…' : 'Try again'}
        </Button>
      </Card>
    )
  }

  if (!data?.available) {
    return (
      <Card title="Ratings">
        <Alert variant="info">
          <p className="font-bold">Ratings aren’t switched on yet</p>
          <p className="mt-1">
            Soon, guests who booked through Sho’t Right will be able to rate their visit, and
            you’ll be able to reply here.
          </p>
        </Alert>
      </Card>
    )
  }

  const Switcher = (
    <div className="flex gap-1 rounded-lg bg-gray-100 p-1" role="group" aria-label="Which ratings">
      {[
        ['all', 'All'],
        ['unreplied', `Awaiting reply${data.unreplied ? ` (${data.unreplied})` : ''}`],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={showing === key}
          onClick={() => {
            setShowing(key)
            setLimit(RATINGS_PAGE)
          }}
          className={`rounded-md px-3 py-1 text-xs font-bold ${
            showing === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const more = data.total > data.ratings.length && limit < RATINGS_MAX_PAGE

  return (
    <Card title="Ratings" action={Switcher}>
      <Summary data={data} />

      {data.ratings.length === 0 ? (
        <EmptyState
          title={unrepliedOnly ? 'You’re all caught up' : 'No ratings yet'}
          description={
            unrepliedOnly
              ? 'Every rating has a reply.'
              : 'After a guest’s visit, the app asks them to rate it. Their ratings will show up here.'
          }
        />
      ) : (
        <ul className="divide-y divide-gray-200">
          {data.ratings.map((rating) => (
            <RatingRow key={rating.id} rating={rating} />
          ))}
        </ul>
      )}

      {more && (
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => setLimit((n) => Math.min(n + RATINGS_PAGE, RATINGS_MAX_PAGE))}
          disabled={isFetching}
        >
          {isFetching ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </Card>
  )
}

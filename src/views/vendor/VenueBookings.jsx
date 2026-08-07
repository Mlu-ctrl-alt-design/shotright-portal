import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Badge, Button, Card } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { BOOKING_LIMIT, getVenueBookings, localDate } from '../../services/bookings'

/**
 * Who is coming, and when.
 *
 * THE ONE THING THIS SCREEN MUST NOT DO is show an empty table it cannot stand
 * behind. "No bookings yet" and "we cannot see your bookings" are completely
 * different sentences to a restaurant owner: the first is a quiet Tuesday, the
 * second is a reason to stop trusting the portal on a Friday night. Now that
 * `get_venue_bookings` answers, the empty state is finally something we know
 * rather than something we assume — which is what makes it safe to say.
 *
 * The layout is built for one job: standing at a door with a phone. Grouped by
 * day, earliest first, with the time and the covers big enough to read at a
 * glance and the phone number one tap from dialling.
 */

const DAY = new Intl.DateTimeFormat('en-ZA', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/** `YYYY-MM-DD` → "Friday, 8 August", without letting the browser guess a zone. */
const dayLabel = (iso) => {
  if (!iso) return 'Date not set'
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return String(iso)
  const date = new Date(y, m - 1, d)
  if (iso === localDate()) return `Today · ${DAY.format(date)}`
  if (iso === localDate(1)) return `Tomorrow · ${DAY.format(date)}`
  return DAY.format(date)
}

/** `19:30:00` → `19:30`. Seconds on a booking time are noise. */
const timeLabel = (value) => {
  if (!value) return null
  const match = String(value).match(/^(\d{1,2}):(\d{2})/)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : String(value)
}

/**
 * "4 people", and the split only when it changes what you do.
 *
 * `party_size` is the server's number and the one we show. Adults and children
 * are named separately only when there ARE children, because a high chair is a
 * different table.
 */
const partyLabel = ({ people, adults, children }) => {
  const total = people || adults + children
  if (!total) return null
  const head = `${total} ${total === 1 ? 'person' : 'people'}`
  return children > 0 ? `${head} · ${adults} adult${adults === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'}` : head
}

const groupByDay = (bookings) => {
  const days = new Map()
  for (const booking of bookings) {
    const key = booking.date || ''
    if (!days.has(key)) days.set(key, [])
    days.get(key).push(booking)
  }
  return [...days.entries()]
}

function BookingRow({ booking }) {
  const party = partyLabel(booking)
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 gap-4">
        <p className="w-14 shrink-0 text-sm font-bold tabular-nums text-ink-900">
          {timeLabel(booking.time) || '—'}
        </p>
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-900">{booking.guest || 'Guest'}</p>
          {party && <p className="mt-0.5 text-sm text-ink-700">{party}</p>}
          {booking.phone && (
            /* One tap to dial. A booking sheet you have to retype numbers off
               is a booking sheet that stays on paper. */
            <a
              className="mt-0.5 inline-block text-sm text-brand-700 underline"
              href={`tel:${booking.phone.replace(/\s+/g, '')}`}
            >
              {booking.phone}
            </a>
          )}
          {booking.note && <p className="mt-1 text-sm text-ink-700">{booking.note}</p>}
        </div>
      </div>
      {/* Absent from the endpoint today. Rendered only if a server ever sends
          one — never invented, because "Confirmed" is a promise. */}
      {booking.status && <Badge tone="Pending">{booking.status}</Badge>}
    </li>
  )
}

export default function VenueBookings() {
  const { venueId } = useParams()
  /* Upcoming is the working view: a door only cares about who is still coming.
     Earlier exists so that "where did Friday's booking go?" has an answer other
     than us having quietly hidden it. */
  const [showing, setShowing] = useState('upcoming')
  const range = showing === 'upcoming' ? { from: localDate() } : { to: localDate(-1) }

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['bookings', venueId, showing],
    queryFn: () => getVenueBookings(venueId, range),
    enabled: !!venueId,
  })

  if (isLoading) return <Spinner label="Loading bookings…" />

  const Switcher = (
    <div className="flex gap-1 rounded-lg bg-gray-100 p-1" role="group" aria-label="Which bookings">
      {[
        ['upcoming', 'Upcoming'],
        ['past', 'Earlier'],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={showing === key}
          onClick={() => setShowing(key)}
          className={`rounded-md px-3 py-1 text-xs font-bold ${
            showing === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  /* Deployed, and it threw. A bad minute, not a missing feature — so the way
     out is to try again, not to explain our roadmap. */
  if (data?.errored) {
    return (
      <Card title="Bookings" action={Switcher}>
        <Alert variant="warning">
          <p className="font-bold">We couldn’t load your bookings just now</p>
          <p className="mt-1">
            Nothing has changed about them — this is on our side. Please try again.
          </p>
        </Alert>
        <Button className="mt-4" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Trying…' : 'Try again'}
        </Button>
      </Card>
    )
  }

  if (!data?.available) {
    return (
      <Card title="Bookings">
        <Alert variant="info">
          <p className="font-bold">Bookings aren’t switched on yet</p>
          <p className="mt-1">
            This isn’t an empty diary — we can’t see your bookings from here at all, so we can’t
            tell you whether you have any.{' '}
            <strong>Keep taking bookings the way you do now.</strong> When this is ready, they’ll
            show up here on their own.
          </p>
        </Alert>
      </Card>
    )
  }

  if (!data.bookings.length) {
    return (
      <Card title="Bookings" action={Switcher}>
        {/* Only reachable once the endpoint answers, which is what makes this
            sentence safe to say. */}
        <p className="text-sm text-ink-700">
          {showing === 'upcoming'
            ? 'No one is booked in yet. New bookings appear here as customers make them.'
            : 'No bookings before today.'}
        </p>
      </Card>
    )
  }

  const days = groupByDay(data.bookings)
  const covers = data.bookings.reduce((sum, b) => sum + (b.people || 0), 0)

  return (
    <Card title="Bookings" action={Switcher}>
      <p className="text-xs text-ink-500">
        {data.bookings.length} booking{data.bookings.length === 1 ? '' : 's'}
        {covers ? ` · ${covers} covers` : ''}
      </p>

      {days.map(([date, list]) => (
        <section key={date || 'undated'} className="mt-5 first:mt-4">
          <h3 className="text-sm font-bold text-ink-900">{dayLabel(date)}</h3>
          <ul className="mt-1 divide-y divide-gray-200">
            {list.map((booking) => (
              <BookingRow key={booking.id} booking={booking} />
            ))}
          </ul>
        </section>
      ))}

      {/* A full page and "there are exactly 100" look identical from here, so
          we say which one we cannot tell apart rather than implying it ends. */}
      {data.truncated && (
        <p className="mt-5 text-xs text-ink-500">
          Showing the first {BOOKING_LIMIT}. There may be more.
        </p>
      )}
    </Card>
  )
}

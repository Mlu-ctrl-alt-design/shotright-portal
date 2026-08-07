import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Alert, Badge, Card } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { getVenueBookings } from '../../services/bookings'

/**
 * Who is coming, and when.
 *
 * THE ONE THING THIS SCREEN MUST NOT DO is show an empty table. "No bookings
 * yet" and "we cannot see your bookings" are completely different sentences to
 * a restaurant owner: the first is a quiet Tuesday, the second is a reason to
 * stop trusting the portal on a Friday night. The portal cannot currently tell
 * the difference from the bench, so it says which one it actually knows.
 *
 * Nothing serves bookings yet — see `services/bookings.js`. The tab exists
 * because a partner asked where their bookings are, and an absent tab answers
 * that question worse than a present one that explains itself.
 */
const zar = new Intl.DateTimeFormat('en-ZA', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const when = (value) => {
  if (!value) return null
  const date = new Date(String(value).replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? String(value) : zar.format(date)
}

export default function VenueBookings() {
  const { venueId } = useParams()
  const { data, isLoading } = useQuery({
    queryKey: ['bookings', venueId],
    queryFn: () => getVenueBookings(venueId),
    enabled: !!venueId,
  })

  if (isLoading) return <Spinner label="Loading bookings…" />

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
      <Card title="Bookings">
        {/* Only reachable once the endpoint answers, which is what makes this
            sentence safe to say. */}
        <p className="text-sm text-ink-700">
          No bookings for this venue yet. They’ll appear here as customers make them.
        </p>
      </Card>
    )
  }

  return (
    <Card
      title="Bookings"
      action={
        <span className="text-xs text-ink-500">
          {data.bookings.length} booking{data.bookings.length === 1 ? '' : 's'}
        </span>
      }
    >
      <ul className="divide-y divide-gray-200">
        {data.bookings.map((booking) => (
          <li key={booking.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-900">
                {booking.guest || 'Guest'}
                {booking.people ? ` · ${booking.people} people` : ''}
              </p>
              {when(booking.when) && (
                <p className="mt-0.5 text-sm text-ink-700">{when(booking.when)}</p>
              )}
              {booking.phone && <p className="mt-0.5 text-sm text-ink-700">{booking.phone}</p>}
              {booking.note && <p className="mt-1 text-sm text-ink-700">{booking.note}</p>}
            </div>
            {booking.status && <Badge tone="Pending">{booking.status}</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  )
}

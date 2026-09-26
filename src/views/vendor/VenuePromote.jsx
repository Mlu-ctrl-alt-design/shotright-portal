import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Badge, Button, Card } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { REASONS, getPromotionOffer, getVenuePromotions, startPromotion } from '../../services/promotions'

/**
 * Promote this venue: a week or more at the top of nearby searches in the app.
 *
 * What a partner is buying, said plainly on the page because it is money:
 * the venue is shown first — marked "Sponsored" — to customers searching
 * nearby, for the weeks chosen, and only if it is already in their results.
 * It never appears for someone far away, and it is never the Surprise Me pick.
 */

const RANDS = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const DATE = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long' })

const dateLabel = (iso) => {
  const [y, m, d] = String(iso || '').split('-').map(Number)
  return y && m && d ? DATE.format(new Date(y, m - 1, d)) : ''
}

function PromotionsList({ promotions }) {
  if (!promotions.length) return null
  return (
    <Card title="Your promotions">
      <ul className="divide-y divide-gray-200">
        {promotions.map((p) => (
          <li key={p.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-bold text-ink-900">
                {dateLabel(p.starts_on)} – {dateLabel(p.ends_on)}
              </p>
              <p className="mt-0.5 text-sm text-ink-700">
                {p.weeks} {p.weeks === 1 ? 'week' : 'weeks'} · {RANDS.format(p.price_zar)}
                {p.moods?.length ? ` · ${p.moods.join(', ')}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-700">
                {p.bookings} {p.bookings === 1 ? 'booking' : 'bookings'}
              </span>
              {p.live && <Badge tone="Approved">Live now</Badge>}
              {p.upcoming && <Badge tone="Pending">Starts {dateLabel(p.starts_on)}</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default function VenuePromote() {
  const { venueId } = useParams()

  const offerQuery = useQuery({
    queryKey: ['promotion-offer', venueId],
    queryFn: () => getPromotionOffer(venueId),
    enabled: !!venueId,
  })
  const listQuery = useQuery({
    queryKey: ['promotions', venueId],
    queryFn: () => getVenuePromotions(venueId),
    enabled: !!venueId && !!offerQuery.data?.available,
  })

  const [weeks, setWeeks] = useState(1)
  const [startsOn, setStartsOn] = useState('')
  const [moods, setMoods] = useState([])

  const pay = useMutation({
    mutationFn: () => startPromotion({ venueId, weeks, startsOn, moods }),
  })

  if (offerQuery.isLoading) return <Spinner label="Loading…" />

  const { available, errored, offer } = offerQuery.data || {}

  if (errored) {
    return (
      <Card title="Promote this venue">
        <Alert variant="warning">We couldn’t load promotion options just now. Please try again.</Alert>
      </Card>
    )
  }
  if (!available) {
    return (
      <Card title="Promote this venue">
        <Alert variant="info">
          <p className="font-bold">Promotions aren’t switched on yet</p>
          <p className="mt-1">Soon you’ll be able to put this venue at the top of nearby searches in the app.</p>
        </Alert>
      </Card>
    )
  }

  const total = offer.price_per_week * weeks
  const start = startsOn || offer.earliest_start
  const toggleMood = (mood) =>
    setMoods((current) => (current.includes(mood) ? current.filter((m) => m !== mood) : [...current, mood]))

  return (
    <div className="space-y-6">
      <Card title="Promote this venue">
        <p className="text-sm text-ink-700">
          Customers searching near {offer.town || 'your venue'} see {offer.venue_name} first, marked{' '}
          <strong>Sponsored</strong>. It only shows to people for whom it’s already nearby, and bookings that
          come from it are counted below.
        </p>

        {!offer.can_promote ? (
          <Alert variant="info" className="mt-4">
            {REASONS[offer.reason] || 'This venue can’t be promoted right now.'}
          </Alert>
        ) : (
          <form
            className="mt-5 space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              pay.mutate()
            }}
          >
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-ink-900">How long?</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Weeks">
                {Array.from({ length: offer.max_weeks }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={weeks === n}
                    onClick={() => setWeeks(n)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold ring-2 ${
                      weeks === n ? 'bg-brand-500 text-ink-900 ring-brand-500' : 'bg-white text-ink-700 ring-field'
                    }`}
                  >
                    {n} {n === 1 ? 'week' : 'weeks'}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="promo-start" className="mb-1.5 block text-sm font-semibold text-ink-900">
                Starting
              </label>
              <input
                id="promo-start"
                type="date"
                min={offer.earliest_start}
                max={offer.latest_start}
                value={start}
                onChange={(e) => setStartsOn(e.target.value)}
                className="rounded-2xl border-2 border-field px-4 py-2 text-sm"
              />
              {offer.booked_windows?.length > 0 && (
                <p className="mt-1.5 text-xs text-ink-500">
                  Already promoted:{' '}
                  {offer.booked_windows.map((w) => `${dateLabel(w.starts_on)} – ${dateLabel(w.ends_on)}`).join('; ')}
                </p>
              )}
            </div>

            {offer.moods?.length > 0 && (
              <fieldset>
                <legend className="mb-1 text-sm font-semibold text-ink-900">Only for these moods (optional)</legend>
                <p className="mb-2 text-xs text-ink-500">
                  Leave all unticked to show on any nearby search.
                </p>
                <div className="flex flex-wrap gap-3">
                  {offer.moods.map((mood) => (
                    <label key={mood} className="flex items-center gap-2 text-sm text-ink-900">
                      <input
                        type="checkbox"
                        checked={moods.includes(mood)}
                        onChange={() => toggleMood(mood)}
                        className="size-4 accent-brand-500"
                      />
                      {mood}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <Alert variant="danger">{pay.error?.message}</Alert>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
              <p className="text-sm text-ink-700">
                {weeks} × {RANDS.format(offer.price_per_week)} ={' '}
                <strong className="text-lg text-ink-900">{RANDS.format(total)}</strong>
              </p>
              <Button type="submit" loading={pay.isPending || pay.data?.redirected}>
                {pay.isPending || pay.data?.redirected ? 'Taking you to Payfast…' : `Pay ${RANDS.format(total)} with Payfast`}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <PromotionsList promotions={listQuery.data || []} />
    </div>
  )
}

import { Link, useParams } from 'react-router-dom'
import { useVenue, useMenu, useVenuePhotos } from '../../hooks/useVendor'
import { Alert, Card } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { deriveSections, sectionTally } from '../../services/venueProgress'

/**
 * The venue at a glance.
 *
 * The landing tab, and deliberately not a dashboard: a partner opening a venue
 * wants to know what state it is in and what is missing, then go and fix that
 * thing. So every row that isn't done is a link to the screen that fixes it,
 * and the ones that are done are quiet.
 *
 * The completeness rows come from `deriveSections`, the same function the
 * pending screen uses — one definition of "what a listing needs", not two that
 * drift.
 */
export default function VenueOverview() {
  const { venueId } = useParams()
  const { data: venue, isLoading, error } = useVenue(venueId)
  const { data: menuData } = useMenu(venueId)
  const { data: photoData } = useVenuePhotos(venueId)

  if (isLoading) return <Spinner label="Loading venue…" />
  if (error) return <Alert variant="danger">{error.message}</Alert>

  const sections = deriveSections(venue, {
    photos: photoData?.photos || [],
    menu: menuData?.headings || [],
  })
  const tally = sectionTally(sections)
  const outstanding = sections.filter((s) => s.state !== 'done')

  const href = (section) =>
    section.to === 'menu' ? `/venues/${venueId}/menu` : `/venues/${venueId}/edit`

  return (
    <div className="space-y-6">
      <Card
        title="What’s in this listing"
        action={
          <span className="text-xs text-ink-500">
            {tally.done} of {tally.total} complete
          </span>
        }
      >
        <ul className="divide-y divide-gray-200">
          {sections.map((section) => (
            <li key={section.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink-900">{section.label}</p>
                <p className="mt-0.5 text-sm text-ink-700">{section.detail}</p>
              </div>
              {section.state === 'done' ? (
                <span className="text-xs font-semibold text-ink-500">Added</span>
              ) : (
                <Link
                  to={href(section)}
                  className="text-sm font-bold text-brand-ink underline underline-offset-2"
                >
                  {section.state === 'partial' ? 'Finish this' : 'Add this'} →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {outstanding.length === 0 && (
        <Alert variant="success">
          Everything a listing needs is here. Anything else you add is polish.
        </Alert>
      )}
    </div>
  )
}

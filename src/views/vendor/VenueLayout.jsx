import { NavLink, Outlet, useParams } from 'react-router-dom'
import { useVenue } from '../../hooks/useVendor'
import { Badge } from '../../components/ui'
import { bucketOf, stateLabel, stateTone } from '../../services/workflowState'
import { clsx } from '../../utils/clsx'

/**
 * One venue, one place.
 *
 * Until now a venue was scattered across four unrelated URLs — edit here, menu
 * there, photos inside the edit form, status somewhere else — and the only way
 * between them was the browser's back button. A partner thinks in venues, not
 * in screens: "the Long Street place" is the unit of work, and everything they
 * do to it belongs under it.
 *
 * This is a LAYOUT rather than a new page, so every existing URL keeps working
 * and simply gains the tab bar. `/venues/VEN-1/menu` is still `/venues/VEN-1/menu`
 * — no bookmark breaks, nothing in anyone's history dead-ends, and the routes
 * the wizard and the decline screen already navigate to are untouched.
 *
 * The venue is fetched once here and the tabs render inside it, so moving
 * between them doesn't re-fetch or flash a spinner.
 */
const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'edit', label: 'Details, hours & photos' },
  { to: 'menu', label: 'Menu' },
  { to: 'bookings', label: 'Bookings' },
  { to: 'preview', label: 'Preview' },
]

export default function VenueLayout() {
  const { venueId } = useParams()
  const { data: venue } = useVenue(venueId)
  const bucket = bucketOf(venue?.workflow_state)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-ink-900">
            {venue?.venue_name || 'Venue'}
          </h1>
          {venue?.address && <p className="mt-0.5 text-sm text-ink-700">{venue.address}</p>}
        </div>
        {venue?.workflow_state && (
          <Badge tone={stateTone(venue.workflow_state)}>{stateLabel(venue.workflow_state)}</Badge>
        )}
      </div>

      {/* A declined venue's reason is not a tab — it is the only thing that
          matters about that venue until it is fixed, so it stays a loud link
          rather than one of five equal-weight destinations. */}
      {bucket === 'declined' && (
        <NavLink
          to={`/venues/${venueId}/review`}
          className="inline-block font-bold text-red-700 underline underline-offset-2"
        >
          See why this venue wasn’t approved →
        </NavLink>
      )}

      <nav aria-label="Venue sections" className="overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-brand-100">
          {TABS.map((tab) => (
            <li key={tab.label}>
              <NavLink
                to={tab.to ? `/venues/${venueId}/${tab.to}` : `/venues/${venueId}`}
                end={tab.end}
                className={({ isActive }) =>
                  clsx(
                    'inline-block border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition',
                    isActive
                      ? 'border-brand-500 text-ink-900'
                      : 'border-transparent text-ink-700 hover:text-ink-900',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet />
    </div>
  )
}

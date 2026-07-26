import { Link } from 'react-router-dom'
import { useVenues } from '../../hooks/useVendor'
import { Badge, Button, EmptyState, Alert } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'

// Issue #15 — a vendor only ever sees and edits their own venues; the endpoint
// scopes by the session's Vendor Profile. The optional `status` prop backs the
// Declined and Pending sidebar destinations, which the designs treat as their
// own pages rather than as filters on one list.
export default function VenueList({ status, heading = 'My venues' }) {
  const { data, isLoading, error } = useVenues()

  if (isLoading) return <Spinner label="Loading venues…" />
  if (error) return <Alert variant="danger">{error.message}</Alert>

  const venues = status ? data.filter((v) => v.workflow_state === status) : data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-ink-900">{heading}</h1>
        <Link to="/venues/new">
          <Button>Add venue</Button>
        </Link>
      </div>

      {venues.length === 0 ? (
        <EmptyState
          title={status ? `No ${status.toLowerCase()} venues` : 'No venues yet'}
          description={
            status
              ? `Nothing here right now. Venues appear on this page while they are ${status.toLowerCase()}.`
              : 'Add your first venue to start appearing in mood searches.'
          }
          action={
            <Link to="/venues/new">
              <Button>Add venue</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
          {/* UNTITLED UI: https://www.untitledui.com/react/components/tables */}
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Venue</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Dress code</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {venues.map((venue) => (
                <tr key={venue.name}>
                  <td className="px-5 py-4">
                    <p className="font-medium text-ink-900">{venue.venue_name}</p>
                    <p className="text-xs text-ink-500">{venue.address}</p>
                  </td>
                  <td className="px-5 py-4">
                    <Badge>{venue.workflow_state}</Badge>
                  </td>
                  <td className="px-5 py-4 text-ink-700">{venue.dress_code || '—'}</td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-4">
                      <Link
                        to={`/venues/${venue.name}/menu`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        Menu
                      </Link>
                      <Link
                        to={`/venues/${venue.name}/edit`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        Edit
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

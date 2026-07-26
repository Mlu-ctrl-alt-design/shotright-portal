import { Link } from 'react-router-dom'
import { useDashboard } from '../../hooks/useVendor'
import { Badge, Button, Card, MetricCard, EmptyState, Alert } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'

/**
 * Issue #18 — Vendor Portal Dashboard.
 * Lists the vendor's own venues with approval status, plus a profile summary.
 * No tier/package gating in this phase — every vendor sees the same thing.
 */
export default function Dashboard() {
  const { data, isLoading, error } = useDashboard()

  if (isLoading) return <Spinner label="Loading dashboard…" />
  if (error) return <Alert variant="danger">{error.message}</Alert>

  const { stats, venues, profile } = data

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">
            Welcome back, {profile?.vendor_name?.split(' ')[0] || 'Vendor'}
          </h1>
          <p className="mt-1 text-sm text-ink-500">{profile?.business_name}</p>
        </div>
        <Link to="/venues/new">
          <Button>Add venue</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total venues" value={stats.total} />
        <MetricCard label="Approved" value={stats.approved} tone="positive" />
        <MetricCard label="Pending review" value={stats.pending} tone="warning" />
        <MetricCard label="Rejected" value={stats.rejected} tone="negative" />
      </div>

      <Card
        title="Your venues"
        action={
          <Link to="/venues" className="text-sm font-semibold text-brand-600 hover:underline">
            View all
          </Link>
        }
      >
        {venues.length === 0 ? (
          <EmptyState
            title="No venues yet"
            description="Add your first venue to start appearing in mood searches."
            action={
              <Link to="/venues/new">
                <Button>Add venue</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-gray-200">
            {venues.map((venue) => (
              <li key={venue.name} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{venue.venue_name}</p>
                  <p className="truncate text-xs text-ink-500">{venue.address}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge>{venue.workflow_state}</Badge>
                  <Link
                    to={`/venues/${venue.name}/edit`}
                    className="text-sm font-medium text-brand-600 hover:underline"
                  >
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Profile summary">
        <dl className="grid gap-4 sm:grid-cols-2">
          {[
            ['Contact name', profile?.vendor_name],
            ['Business name', profile?.business_name],
            ['Email', profile?.email],
            ['Phone', profile?.phone],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
              <dd className="mt-1 text-sm text-ink-900">{value || '—'}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5">
          <Link to="/profile">
            <Button variant="secondary" size="sm">
              Edit profile
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}

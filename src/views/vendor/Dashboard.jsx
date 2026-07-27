import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useDashboard } from '../../hooks/useVendor'
import { useSetupDrafts } from '../../hooks/useSetupDraft'
import { discardDraft } from '../../services/setupDraft'
import { Badge, Button, Card, MetricCard, EmptyState, Alert } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import ResumeSetupCard from '../../components/ui/ResumeSetupCard'
import { inBucket, stateLabel, stateTone } from '../../services/workflowState'

/**
 * Issue #18 — Vendor Portal Dashboard.
 * Lists the vendor's own venues with approval status, plus a profile summary.
 * No tier/package gating in this phase — every vendor sees the same thing.
 */
export default function Dashboard() {
  const { data, isLoading, error } = useDashboard()
  const { data: drafts = [] } = useSetupDrafts()
  const qc = useQueryClient()

  // The most recently touched unfinished setup. One card, not a list: someone
  // with three abandoned drafts is being asked which one they meant, which is
  // the dashboard interrogating them instead of helping. The rest stay
  // reachable from the venues list.
  const resumable = drafts[0] || null

  const dropDraft = async (draft) => {
    await discardDraft(draft.id)
    qc.invalidateQueries({ queryKey: ['venue-drafts'] })
  }

  if (isLoading) return <Spinner label="Loading dashboard…" />
  if (error) return <Alert variant="danger">{error.message}</Alert>

  // The fixtures always returned a complete payload, so this used to destructure
  // straight into `stats.total` and `venues.length`. The live bench makes no
  // such promise — a vendor with no venues can come back with no `stats` key at
  // all — and the result was a white screen with a console error, which is the
  // worst possible way to learn you have no venues yet.
  //
  // Counts are derived from `venues` when the backend omits them rather than
  // rendered as zero, so the tiles always agree with the list underneath them.
  const profile = data?.profile
  const venues = data?.venues ?? []

  // Counted from the venue list rather than trusting `data.stats`, so the tiles
  // can never disagree with the list they link to. A tile reading "1 declined"
  // that opens an empty tab is worse than either number alone — and the tiles
  // and tabs must classify states the same way, which means one shared matcher.
  const countBy = (bucket) => venues.filter((v) => inBucket(v, bucket)).length
  const stats = {
    total: venues.length ?? data?.stats?.total ?? 0,
    approved: countBy('approved'),
    pending: countBy('pending'),
    rejected: countBy('declined'),
  }

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

      {/* Above the tiles, deliberately. An unfinished setup is the only thing on
          this page with a deadline attached to a human being's attention — the
          counts will still be there after they have finished it. */}
      {resumable && <ResumeSetupCard draft={resumable} onDiscard={dropDraft} />}

      {/* Each tile is a link to the tab it counts. "3 pending" raises the
          question "which three?" and the tile is where that gets asked. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard as={Link} to="/venues" label="Total venues" value={stats.total} />
        <MetricCard
          as={Link}
          to="/venues?status=approved"
          label="Approved"
          value={stats.approved}
          tone="positive"
        />
        <MetricCard
          as={Link}
          to="/venues?status=pending"
          label="Pending review"
          value={stats.pending}
          tone="warning"
        />
        <MetricCard
          as={Link}
          to="/venues?status=declined"
          label="Declined"
          value={stats.rejected}
          tone="negative"
        />
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
                  <Badge tone={stateTone(venue.workflow_state)}>
                    {stateLabel(venue.workflow_state)}
                  </Badge>
                  {/* A Declined badge with only "Edit" next to it asks someone
                      to fix something without telling them what. */}
                  {inBucket(venue, 'declined') && (
                    <Link
                      to={`/venues/${venue.name}/review`}
                      aria-label={`Why ${venue.venue_name} was declined`}
                      className="text-sm font-bold text-red-700 hover:underline"
                    >
                      See why
                    </Link>
                  )}
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

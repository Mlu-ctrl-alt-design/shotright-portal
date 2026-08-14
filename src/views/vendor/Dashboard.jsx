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
    const result = await discardDraft(draft.id)
    qc.invalidateQueries({ queryKey: ['venue-drafts'] })
    // Handed back so the card can say so. It used to swallow this, which is
    // how a button that deleted nothing looked exactly like one that worked.
    return result
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
          <ul className="-mx-2 divide-y divide-gray-200">
            {venues.map((venue) => {
              const declined = inBucket(venue, 'declined')
              return (
                /**
                 * THE ROW IS THE LINK.
                 *
                 * It used to be a name on the far left and three separate
                 * controls on the far right — a badge, sometimes "See why", and
                 * an "Edit" on every single row. Three problems came out of
                 * that, and they compounded:
                 *
                 *  1. The badges never lined up. A declined row carries an extra
                 *     control, so it pushed its badge left and the column read
                 *     as ragged rather than as a column.
                 *  2. "Edit" repeated down every row is a wall of identical
                 *     links — unusable with a screen reader without an
                 *     aria-label per row, and visual noise with one.
                 *  3. On a wide screen there was a thousand pixels of nothing
                 *     between the name and its status, so the eye had to track
                 *     across empty space to answer "is this one live?".
                 *
                 * Making the whole row the target fixes all three: one hit area
                 * instead of a small link, the badge sits in a fixed column that
                 * cannot be pushed, and the row is scannable because name and
                 * status are the only two things in it.
                 *
                 * It goes to the venue hub rather than the edit form — that page
                 * has the menu, hours, photos and bookings, and "open my venue"
                 * is the intent behind the click far more often than "edit the
                 * name of my venue".
                 */
                <li key={venue.name} className="relative">
                  <div className="flex items-center gap-4 rounded-xl px-2 py-2.5 transition-colors hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/venues/${venue.name}`}
                        /* Stretched link: the anchor is the row's hit area, and
                           anything that must stay separately clickable sits
                           above it in the stacking order. An <a> inside an <a>
                           is invalid HTML and the browser will silently
                           un-nest it. */
                        className="text-sm font-semibold text-ink-900 before:absolute before:inset-0 before:content-[''] hover:underline"
                      >
                        {venue.venue_name}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {venue.address || 'No address yet'}
                      </p>
                    </div>

                    {/* Fixed column, so every badge on the list starts at the
                        same x whatever else the row contains. */}
                    <Badge tone={stateTone(venue.workflow_state)}>
                      {stateLabel(venue.workflow_state)}
                    </Badge>

                    {/* The ONLY explicit action, and only where it means
                        something. It used to be bold red, which shouted louder
                        than the venue's own name — the badge beside it already
                        carries the alarm, so this just has to be reachable. */}
                    {declined && (
                      <Link
                        to={`/venues/${venue.name}/review`}
                        aria-label={`Why ${venue.venue_name} was declined`}
                        className="relative z-10 shrink-0 text-sm font-semibold text-red-700 underline underline-offset-2 hover:text-red-800"
                      >
                        Why?
                      </Link>
                    )}
                  </div>
                </li>
              )
            })}
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

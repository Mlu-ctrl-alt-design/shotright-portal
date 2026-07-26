import { Link, useSearchParams } from 'react-router-dom'
import { useVenues } from '../../hooks/useVendor'
import { Badge, Button, EmptyState, Alert } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { clsx } from '../../utils/clsx'

/**
 * The vendor's venues, filtered by approval state.
 *
 * Approved, Pending and Declined used to be three sidebar destinations. They
 * are not three things — they are one list in three states, and modelling a
 * state as a navigation item means the nav grows every time the workflow does.
 * They are tabs on one page now, and the nav is four stable items regardless of
 * how many states the workflow ends up with.
 *
 * THE TABS ARE LINKS, not the ARIA tab pattern. That pattern implies arrow-key
 * traversal and a `tabpanel` owned by the tablist, which is right for panels
 * inside a page and wrong here: these change the URL. As links they are
 * shareable, bookmarkable, open in a new tab on middle-click, and work with
 * back/forward — none of which `role="tab"` gives you, and all of which someone
 * will expect from something that changes what the address bar says. They are
 * styled as tabs because that is what the user is being offered; the semantics
 * follow the behaviour, not the appearance.
 *
 * State lives in `?status=`, not in component state, for the same reason.
 *
 * Issue #15 — a vendor only ever sees and edits their own venues; the endpoint
 * scopes by the session's Vendor Profile.
 */

/**
 * `value` is the backend's `workflow_state`; `label` is what partners are shown.
 * The designs say "Declined" and the workflow says "Rejected" — the mapping
 * lives here rather than being papered over in either direction.
 */
const TABS = [
  { key: '', label: 'All', value: null },
  { key: 'approved', label: 'Approved', value: 'Approved' },
  { key: 'pending', label: 'Pending', value: 'Pending' },
  { key: 'declined', label: 'Declined', value: 'Rejected' },
]

/**
 * The workflow says "Rejected"; the designs say "Declined". Partners should see
 * one word for one state — a "Declined" tab listing rows badged "Rejected"
 * invites the reasonable question of whether they are different things.
 *
 * Translating here, at the last possible moment, keeps the backend value intact
 * everywhere else. Unknown states pass through rather than being swallowed: if
 * the workflow grows a state, showing its raw name is far better than showing
 * nothing.
 */
const STATE_LABELS = { Rejected: 'Declined' }
export const stateLabel = (state) => STATE_LABELS[state] || state

const EMPTY = {
  approved: {
    title: 'No approved venues yet',
    description:
      'Venues appear here once the Sho’t Right team has reviewed them. Anything waiting is under Pending.',
  },
  pending: {
    title: 'Nothing waiting for review',
    description: 'Venues you submit show up here until the Sho’t Right team has looked at them.',
  },
  declined: {
    title: 'Nothing declined',
    description:
      'Venues the team could not approve appear here, so you can fix them and resubmit.',
  },
  '': {
    title: 'No venues yet',
    description: 'Add your first venue to start appearing in mood searches.',
  },
}

export default function VenueList() {
  const [params] = useSearchParams()
  const { data = [], isLoading, error } = useVenues()

  // Unknown values fall back to All rather than showing an empty list under a
  // tab that is not highlighted — which would read as "you have no venues".
  const requested = params.get('status') || ''
  const active = TABS.find((t) => t.key === requested) || TABS[0]

  if (isLoading) return <Spinner label="Loading venues…" />
  if (error) return <Alert variant="danger">{error.message}</Alert>

  // Counted from the list already in memory — `get_vendor_dashboard` returns
  // every venue, so per-tab counts cost nothing and cannot disagree with what
  // the tab actually shows.
  const countFor = (tab) =>
    tab.value ? data.filter((v) => v.workflow_state === tab.value).length : data.length

  const venues = active.value ? data.filter((v) => v.workflow_state === active.value) : data
  const empty = EMPTY[active.key]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-ink-900">My venues</h1>
        <Link to="/venues/new">
          <Button>Add venue</Button>
        </Link>
      </div>

      {/* Scrolls rather than wraps: four tabs fit at 390px, but a fifth state
          should push sideways instead of silently becoming a second row that
          shifts the table down. */}
      <nav aria-label="Filter venues by status" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-brand-200 px-1">
          {TABS.map((tab) => {
            const isActive = tab.key === active.key
            const count = countFor(tab)
            return (
              <li key={tab.key}>
                <Link
                  to={tab.key ? `/venues?status=${tab.key}` : '/venues'}
                  // aria-current is what tells a screen reader which filter is
                  // applied. Colour and a border alone say nothing (WCAG 1.4.1),
                  // and there is no aria-selected without role="tab".
                  aria-current={isActive ? 'page' : undefined}
                  className={clsx(
                    'flex items-center gap-2 whitespace-nowrap rounded-t-lg px-4 py-2.5 text-sm font-bold transition',
                    // -1px pulls the active tab's border over the container's,
                    // so it reads as joined to the content rather than sitting
                    // above a line.
                    isActive
                      ? '-mb-px border-b-2 border-brand-edge text-ink-900'
                      : 'text-ink-700 hover:bg-brand-50 hover:text-ink-900',
                  )}
                >
                  {tab.label}
                  <span
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-xs tabular-nums',
                      isActive ? 'bg-brand-500 text-ink-900' : 'bg-canvas text-ink-700',
                    )}
                  >
                    {count}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {venues.length === 0 ? (
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={
            // Only offer "Add venue" where it is the actual next step. Under
            // Declined it is not — the next step is fixing an existing venue,
            // and there is nothing to fix.
            active.key === '' || active.key === 'approved' ? (
              <Link to="/venues/new">
                <Button>Add venue</Button>
              </Link>
            ) : null
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
          {/* UNTITLED UI: https://www.untitledui.com/react/components/tables */}
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <caption className="sr-only">
              {active.value ? `${active.label} venues` : 'All venues'}
            </caption>
            <thead className="bg-gray-50 text-left text-xs tracking-wide text-ink-500 uppercase">
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
                    <Badge tone={venue.workflow_state}>{stateLabel(venue.workflow_state)}</Badge>
                  </td>
                  <td className="px-5 py-4 text-ink-700">{venue.dress_code || '—'}</td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-4">
                      {/* Names the venue for assistive tech: a column of
                          identical "Edit" links is unusable out of context. */}
                      <Link
                        to={`/venues/${venue.name}/menu`}
                        aria-label={`Menu for ${venue.venue_name}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        Menu
                      </Link>
                      <Link
                        to={`/venues/${venue.name}/edit`}
                        aria-label={`Edit ${venue.venue_name}`}
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

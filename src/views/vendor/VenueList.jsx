import { Link, useSearchParams } from 'react-router-dom'
import { useDashboard } from '../../hooks/useVendor'
import { Badge, Button, EmptyState, Alert, OverflowMenu, OverflowMenuItem } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { clsx } from '../../utils/clsx'
import { inBucket, stateLabel, stateTone, unrecognisedStates } from '../../services/workflowState'

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
 * `bucket` is a FAMILY of backend states, not one literal — see
 * `services/workflowState.js`. Matching on a single exact string is what made
 * a declined venue vanish from this tab entirely.
 */
const TABS = [
  { key: '', label: 'All', bucket: null },
  { key: 'approved', label: 'Approved', bucket: 'approved' },
  { key: 'pending', label: 'Pending', bucket: 'pending' },
  { key: 'declined', label: 'Declined', bucket: 'declined' },
]

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
  // The dashboard payload, not `useVenues` — it carries the venue list AND the
  // backend's own counts, which lets the mismatch check below exist. It is also
  // the same endpoint, so this removes a duplicate request rather than adding
  // one.
  const { data: dash, isLoading, error } = useDashboard()
  const data = dash?.venues ?? []

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
    tab.bucket ? data.filter((v) => inBucket(v, tab.bucket)).length : data.length

  const venues = active.bucket ? data.filter((v) => inBucket(v, active.bucket)) : data
  const empty = EMPTY[active.key]

  // States no tab claims. An empty tab is ambiguous — "nothing declined" and
  // "we did not recognise the word your bench uses" look identical — so when
  // both are true, say which.
  const unknown = unrecognisedStates(data)

  /**
   * The backend says there are declined venues but sent none.
   *
   * This separates two failures that look identical from the outside: the
   * portal not recognising the bench's word for "declined" (handled by
   * `unknown` above), and `get_vendor_dashboard` counting venues it does not
   * return. The second is a backend bug no amount of client-side matching can
   * fix, and without this it presents as an empty tab with nothing to report.
   */
  const backendCount = Number(dash?.stats?.rejected)
  const missingDeclined =
    Number.isFinite(backendCount) && backendCount > 0 && countFor(TABS[3]) === 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-ink-900">My venues</h1>
        <div className="flex flex-wrap gap-3">
          {/* Secondary, and deliberately so. One venue is the normal case; a
              spreadsheet is for the partner who arrives with eleven, and making
              it the loud option would send everyone else to a CSV template to
              add a single restaurant. */}
          <Link to="/venues/import">
            <Button variant="secondary">Add from a spreadsheet</Button>
          </Link>
          <Link to="/venues/new">
            <Button>Add venue</Button>
          </Link>
        </div>
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

      {missingDeclined && (
        <Alert variant="danger">
          The app reports {backendCount} declined venue{backendCount === 1 ? '' : 's'}, but did
          not send {backendCount === 1 ? 'it' : 'them'} with your list, so
          {backendCount === 1 ? ' it cannot' : ' they cannot'} be shown here. Please let the
          Sho&rsquo;t Right team know — this is a fault on our side, not something you can fix.
        </Alert>
      )}

      {/* Never let an unrecognised status be invisible. The venue is still under
          All with its real status on it, but a partner looking at an empty
          Declined tab has no way to know that without being told. */}
      {unknown.length > 0 && (
        <Alert variant="warning">
          {unknown.length === 1 ? 'One venue has a status' : `${unknown.length} venues have statuses`}{' '}
          this portal doesn&rsquo;t recognise yet ({unknown.map((s) => `“${s}”`).join(', ')}), so
          {unknown.length === 1 ? ' it is' : ' they are'} only under <strong>All</strong>. Please
          let the Sho&rsquo;t Right team know.
        </Alert>
      )}

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
                    <div className="flex items-center gap-3">
                      {/* The listing's face — the cover the partner chose (or
                          photo 1), straight off the dashboard payload so it
                          costs no extra request. alt="" and aria-hidden: the
                          name is right beside it, and announcing "Cover photo
                          of X" before "X" in every row is noise, not
                          information. */}
                      {venue.cover_image ? (
                        <img
                          src={venue.cover_image}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          className="h-12 w-16 shrink-0 rounded-lg object-cover ring-1 ring-gray-200"
                        />
                      ) : (
                        /* No photos yet — the initial, not a broken-image
                           icon, and not an empty gap that would make the
                           column ragged. */
                        <span
                          aria-hidden="true"
                          className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-lg font-bold text-brand-600 ring-1 ring-gray-200"
                        >
                          {(venue.venue_name || '?').trim().charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <p className="font-medium text-ink-900">{venue.venue_name}</p>
                        <p className="text-xs text-ink-500">{venue.address}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Badge tone={stateTone(venue.workflow_state)}>
                      {stateLabel(venue.workflow_state)}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-ink-700">{venue.dress_code || '—'}</td>
                  <td className="px-5 py-4">
                    {/* ONE action in the open, the rest behind "⋯". Five links
                        per row made every row shout; the primary slot answers
                        "what would this partner do next?" — a declined venue's
                        first question is "why?", a pending one's is "how far
                        along?", and an approved one gets Edit. Everything else
                        (and Edit itself, when it is not the primary) waits in
                        the overflow, one click away instead of zero. */}
                    <div className="flex items-center justify-end gap-2">
                      {inBucket(venue, 'declined') ? (
                        <Link
                          to={`/venues/${venue.name}/review`}
                          aria-label={`Why ${venue.venue_name} was declined`}
                          className="font-bold text-red-700 hover:underline"
                        >
                          Why?
                        </Link>
                      ) : inBucket(venue, 'pending') ? (
                        <Link
                          to={`/venues/${venue.name}/review`}
                          aria-label={`Progress of ${venue.venue_name}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Progress
                        </Link>
                      ) : (
                        <Link
                          to={`/venues/${venue.name}/edit`}
                          aria-label={`Edit ${venue.venue_name}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          Edit
                        </Link>
                      )}
                      <OverflowMenu label={`More actions for ${venue.venue_name}`}>
                        {/* Every venue gets Preview. A partner fills in eleven
                            fields across five steps and never sees the thing
                            they are making — the first look as a customer
                            would see it must not be after it is live. */}
                        <OverflowMenuItem
                          as={Link}
                          to={`/venues/${venue.name}/preview`}
                          aria-label={`Preview ${venue.venue_name} as customers see it`}
                        >
                          Preview
                        </OverflowMenuItem>
                        <OverflowMenuItem
                          as={Link}
                          to={`/venues/${venue.name}/menu`}
                          aria-label={`Menu for ${venue.venue_name}`}
                        >
                          Menu
                        </OverflowMenuItem>
                        {/* Edit moves here only when the primary slot is
                            taken by a state-specific answer. */}
                        {(inBucket(venue, 'declined') || inBucket(venue, 'pending')) && (
                            <OverflowMenuItem
                              as={Link}
                              to={`/venues/${venue.name}/edit`}
                              aria-label={`Edit ${venue.venue_name}`}
                            >
                              Edit
                            </OverflowMenuItem>
                          )}
                      </OverflowMenu>
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

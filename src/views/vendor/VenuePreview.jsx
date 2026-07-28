import { Link, useParams } from 'react-router-dom'
import { useVenue, useMenu, useVenuePhotos } from '../../hooks/useVendor'
import { Alert, Badge, Button, Card } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { bucketOf, stateLabel, stateTone } from '../../services/workflowState'

/**
 * "How customers will see this."
 *
 * A partner fills in eleven fields across five steps and never once sees the
 * thing they are making. They are writing a listing blind, and the first time
 * anyone looks at it as a customer would is after it is live — which is the
 * wrong moment to notice that the cover photo is of the car park.
 *
 * WHAT THIS IS HONEST ABOUT. It is a preview built from the same data the
 * customer app is given, not a copy of the customer app — we do not have that
 * app's layout here, and mimicking it pixel-for-pixel would make a promise
 * about placement we cannot keep. So it shows the CONTENT faithfully and says
 * plainly that the arrangement will differ. A partner needs to know "my first
 * photo is the one people see" and "my description is three words long", not
 * where the rounded corners fall.
 *
 * It also refuses to flatter. Missing pieces are shown as the gaps they will
 * actually be — an empty photo frame, "No description" — rather than quietly
 * collapsing so the preview looks tidier than the listing is. A preview that
 * hides absences is worse than none, because it actively reassures.
 */
export default function VenuePreview() {
  const { venueId } = useParams()
  const { data: venue, isLoading, error } = useVenue(venueId)
  const { data: photoData } = useVenuePhotos(venueId)
  const { data: menuData } = useMenu(venueId)

  if (isLoading) return <Spinner label="Building your preview…" />
  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="danger">We couldn’t open this venue. {error.message}</Alert>
        <Link to="/venues">
          <Button variant="secondary">Back to your venues</Button>
        </Link>
      </div>
    )
  }

  const photos = photoData?.photos || []
  const cover = photos[0]
  const rest = photos.slice(1, 5)
  const headings = menuData?.headings || []
  const items = headings.flatMap((h) => h.items || [])
  const bucket = bucketOf(venue?.workflow_state)

  const description = String(venue?.atmosphere_desc || venue?.summary || '')
    .replace(/<[^>]*>/g, '')
    .trim()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-ink-700">{venue?.venue_name}</p>
          <h1 className="mt-0.5 text-2xl font-bold text-ink-900">How customers will see this</h1>
        </div>
        <Badge tone={stateTone(venue?.workflow_state)}>{stateLabel(venue?.workflow_state)}</Badge>
      </div>

      {/* Said before they scroll, not after. Someone who thinks this is the
          real screen will report the spacing as a bug; someone who knows it is
          a content preview will read it for what it is for. */}
      <Alert variant="info">
        This shows <strong>what</strong> customers get, not exactly how it’s laid out — the app
        arranges things its own way. Everything here comes from your listing as it stands right
        now.
      </Alert>

      {bucket !== 'approved' && (
        <Alert variant="warning">
          This venue isn’t live yet, so nobody can see it but you. The preview is what it will look
          like once it’s approved.
        </Alert>
      )}

      <Card title="The listing card">
        <p className="mb-4 text-sm text-ink-700">
          This is what someone scrolling results sees before they tap anything.
        </p>

        <div className="max-w-sm overflow-hidden rounded-3xl bg-white ring-1 ring-brand-200">
          {cover ? (
            <img
              src={cover.file_url}
              alt={`Cover photo of ${venue?.venue_name}`}
              className="h-48 w-full object-cover"
            />
          ) : (
            /* Shown as the hole it is. A card that quietly shrinks to fit no
               photo tells the partner nothing is wrong. */
            <div className="flex h-48 w-full items-center justify-center bg-tint px-6 text-center">
              <p className="text-sm font-bold text-ink-700">
                No photo — customers see a blank space here
              </p>
            </div>
          )}
          <div className="p-4">
            <p className="font-bold text-ink-900">{venue?.venue_name || 'Unnamed venue'}</p>
            <p className="mt-0.5 text-sm text-ink-700">{venue?.address || 'No address'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(venue?.moods || []).length ? (
                venue.moods.map((mood) => (
                  <span
                    key={mood}
                    className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-900"
                  >
                    {mood}
                  </span>
                ))
              ) : (
                <span className="text-xs font-bold text-ink-700">
                  No moods — this venue won’t come up in any mood search
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card title="The venue page">
        {photos.length > 1 && (
          <div className="mb-5 grid grid-cols-4 gap-2">
            {rest.map((photo, index) => (
              <img
                key={photo.file_url || index}
                src={photo.file_url}
                alt={photo.file_name || `Photo ${index + 2} of ${venue?.venue_name}`}
                className="aspect-square w-full rounded-xl object-cover"
              />
            ))}
          </div>
        )}

        <h3 className="text-sm font-bold text-ink-900">About</h3>
        <p className="mt-1 text-sm text-ink-700">
          {description || (
            <span className="font-bold text-ink-900">
              No description — this section is empty for customers.
            </span>
          )}
        </p>

        <h3 className="mt-5 text-sm font-bold text-ink-900">Dress code</h3>
        <p className="mt-1 text-sm text-ink-700">{venue?.dress_code || 'Not set'}</p>

        <h3 className="mt-5 text-sm font-bold text-ink-900">Open</h3>
        {(venue?.operating_hours || []).filter((h) => !h.closed).length ? (
          <ul className="mt-1 space-y-0.5 text-sm text-ink-700">
            {venue.operating_hours
              .filter((h) => !h.closed)
              .map((h, index) => (
                <li key={`${h.day_of_week || h.day}-${index}`}>
                  {h.day_of_week || h.day}: {h.open_time || h.opens} – {h.close_time || h.closes}
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm font-bold text-ink-900">
            No hours — customers can’t tell if you’re open tonight.
          </p>
        )}
      </Card>

      <Card
        title="The menu"
        action={<span className="text-xs text-ink-500">{items.length} items</span>}
      >
        {items.length === 0 ? (
          <p className="text-sm font-bold text-ink-900">
            Nothing on the menu — customers see an empty tab.
          </p>
        ) : (
          <div className="space-y-5">
            {headings.map((heading) => (
              <div key={heading.name || heading.heading}>
                <h3 className="text-sm font-bold text-ink-900">
                  {heading.heading || heading.name}
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {(heading.items || []).map((item, index) => (
                    <li
                      key={item.name || index}
                      className="flex items-baseline justify-between gap-4 text-sm"
                    >
                      <span className="text-ink-700">{item.item_name}</span>
                      <span
                        className={
                          Number(item.price) > 0
                            ? 'font-semibold text-ink-900'
                            : 'font-bold text-ink-900'
                        }
                      >
                        {Number(item.price) > 0 ? `R${item.price}` : 'No price'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link to={`/venues/${venueId}/edit`}>
          <Button>Edit this venue</Button>
        </Link>
        <Link to={`/venues/${venueId}/menu`}>
          <Button variant="secondary">Edit the menu</Button>
        </Link>
        <Link to="/venues">
          <Button variant="secondary">Back to your venues</Button>
        </Link>
      </div>
    </div>
  )
}

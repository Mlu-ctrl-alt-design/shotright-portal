import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  useVenue,
  useMoods,
  useCreateVenue,
  useUpdateVenue,
  useVenuePhotos,
  useSaveVenuePhotos,
} from '../../hooks/useVendor'
import { Button, Input, Textarea, Card, Alert, Badge } from '../../components/ui'
import Spinner from '../../components/ui/Spinner'
import { OperatingHoursEditor } from '../../components/ui/OperatingHours'
import PhotoUploader from '../../components/ui/PhotoUploader'
import { MAX_VENUE_PHOTOS, UPDATE_VENUE_METHOD, uploadVenuePhoto } from '../../services/vendor'
import { isMethodMissing } from '../../services/api'
import { clsx } from '../../utils/clsx'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const blankHours = () =>
  DAYS.map((day) => ({ day_of_week: day, open_time: '09:00', close_time: '22:00', closed: false }))

const EMPTY = {
  venue_name: '',
  address: '',
  latitude: '',
  longitude: '',
  dress_code: '',
  atmosphere_desc: '',
  moods: [],
  operating_hours: blankHours(),
}

/**
 * Issue #15 — Vendor creates Venue.
 *
 * Deliberately ONE flow: details, dress code, atmosphere, mood selection and
 * operating hours are all on this single screen and submit together. The
 * acceptance criteria call this out explicitly ("not split across separate
 * screens"), so resist the temptation to turn it into a wizard.
 *
 * Moods come from the curated Mood Master (#20) — selection only, no freeform
 * creation from the portal. The server sets workflow_state = Pending; the form
 * never sends it.
 */
export default function VenueForm() {
  const { venueId } = useParams()
  const isEdit = !!venueId
  const navigate = useNavigate()

  const { data: existing, isLoading: loadingVenue } = useVenue(venueId)
  const { data: moods = [], isLoading: loadingMoods } = useMoods()
  const createVenue = useCreateVenue()
  const updateVenue = useUpdateVenue(venueId, existing?.venue_name)

  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState(null)
  // Things that did NOT save, on a request that otherwise succeeded. Kept apart
  // from `error` because "your venue saved, except this" and "your venue did
  // not save" need different words and different next steps.
  const [warnings, setWarnings] = useState([])
  const [savedVenue, setSavedVenue] = useState(null)

  /**
   * Photos are kept out of `form` on purpose.
   *
   * They are not edits waiting for Save — each one is already on the bench the
   * moment it finishes uploading, and for an existing venue it is attached to
   * that venue as it goes. What Save does here is persist the ORDER, which is
   * the only part of a gallery that is a pending change.
   */
  const { data: photoData } = useVenuePhotos(venueId)
  const savePhotos = useSaveVenuePhotos(venueId)
  const [photos, setPhotos] = useState([])
  const seeded = useRef(false)

  useEffect(() => {
    // Once. A refetch landing mid-edit must not throw away a photo the partner
    // has just added or an order they have just rearranged.
    if (seeded.current || !photoData) return
    seeded.current = true
    setPhotos(photoData.photos || [])
  }, [photoData])

  useEffect(() => {
    if (existing) {
      setForm({
        ...EMPTY,
        ...existing,
        moods: existing.moods || [],
        operating_hours: existing.operating_hours?.length ? existing.operating_hours : blankHours(),
      })
    }
  }, [existing])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const toggleMood = (moodName) =>
    setForm((f) => ({
      ...f,
      moods: f.moods.includes(moodName)
        ? f.moods.filter((m) => m !== moodName)
        : [...f.moods, moodName],
    }))

  const onSubmit = async (event) => {
    event.preventDefault()
    setError(null)
    setWarnings([])

    if (form.moods.length === 0) {
      setError('Select at least one mood so customers can find this venue.')
      return
    }
    const openDays = form.operating_hours.filter((h) => !h.closed)
    if (openDays.length === 0) {
      setError('A venue must be open on at least one day.')
      return
    }
    const badRow = openDays.find((h) => h.open_time >= h.close_time)
    if (badRow) {
      setError(`${badRow.day_of_week}: closing time must be after opening time.`)
      return
    }

    const payload = {
      ...form,
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
    }

    try {
      const result = isEdit
        ? await updateVenue.mutateAsync(payload)
        : await createVenue.mutateAsync(payload)
      const saved = result?.venue ?? result

      // After the venue, because a photo order is meaningless without the venue
      // it orders. A failure here must not read as "your venue didn't save" —
      // it didn't fail, and the photos are on the bench either way.
      if (photos.length) {
        try {
          await savePhotos.mutateAsync(photos)
        } catch {
          // Deliberately swallowed: see the notice on the Photos card, which
          // has already told the partner the order isn't kept yet.
        }
      }

      /**
       * Something didn't save. Stay put and say so.
       *
       * Navigating away on a partial save is how a silent failure becomes a
       * belief: the partner watches the page change, concludes it worked, and
       * finds out weeks later that customers are searching for a name their
       * venue never had. The name field is also reset to what the server
       * actually holds — leaving their typed name on screen under a warning
       * that it did not save is a screen arguing with itself.
       */
      if (result?.warnings?.length) {
        setWarnings(result.warnings)
        setSavedVenue(saved)
        if (saved?.venue_name) setForm((f) => ({ ...f, venue_name: saved.venue_name }))
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      navigate(`/venues/${saved.name}/menu`)
    } catch (err) {
      setError(
        isMethodMissing(err, UPDATE_VENUE_METHOD)
          ? `We can’t save changes to a venue on this server yet — the portal is asking for ` +
            `${UPDATE_VENUE_METHOD}, and it isn’t there. Nothing has been lost or changed. ` +
            `We’ve flagged it.`
          : err.message,
      )
    }
  }

  if (isEdit && loadingVenue) return <Spinner label="Loading venue…" />

  const busy = createVenue.isPending || updateVenue.isPending

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">
            {isEdit ? 'Edit venue' : 'Add a venue'}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {isEdit
              ? 'Saving changes sends this venue back for review.'
              : 'Your venue goes to our team for approval before it appears in the app.'}
          </p>
        </div>
        <Link to="/venues">
          <Button variant="ghost" type="button">
            Cancel
          </Button>
        </Link>
      </div>

      <Alert variant="danger">{error}</Alert>

      {warnings.length > 0 && (
        <Alert variant="warning">
          <p className="font-bold">Saved — but not all of it</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          {/* Staying put is the point — but a warning you cannot walk away from
              is a trap. The way on stays open. */}
          {savedVenue?.name && (
            <Link
              to={`/venues/${savedVenue.name}/menu`}
              className="mt-2 inline-block font-bold underline underline-offset-2"
            >
              Carry on to the menu →
            </Link>
          )}
        </Alert>
      )}

      <Card title="Venue details">
        <div className="space-y-4">
          <Input
            label="Venue name"
            name="venue_name"
            required
            value={form.venue_name}
            onChange={set('venue_name')}
          />
          <Input label="Address" name="address" value={form.address} onChange={set('address')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Latitude"
              name="latitude"
              type="number"
              step="any"
              placeholder="-26.1929"
              hint="Used for the 15km discovery radius."
              value={form.latitude ?? ''}
              onChange={set('latitude')}
            />
            <Input
              label="Longitude"
              name="longitude"
              type="number"
              step="any"
              placeholder="28.0305"
              value={form.longitude ?? ''}
              onChange={set('longitude')}
            />
          </div>
          <Input
            label="Dress code"
            name="dress_code"
            placeholder="Smart casual"
            value={form.dress_code}
            onChange={set('dress_code')}
          />
          <Textarea
            label="Atmosphere"
            name="atmosphere_desc"
            placeholder="What does a night here feel like?"
            value={form.atmosphere_desc}
            onChange={set('atmosphere_desc')}
          />
        </div>
      </Card>

      {/* The portal had nowhere to put a venue's own photographs at all — a
          partner could write three paragraphs about their room and still leave
          a customer nothing to look at. */}
      <Card title="Photos">
        <PhotoUploader
          photos={photos}
          onChange={setPhotos}
          venueId={venueId}
          upload={uploadVenuePhoto}
          max={MAX_VENUE_PHOTOS}
          label="Photos of this venue"
          notice={
            // Known BEFORE they start, from the read: `ordered: false` means the
            // photos came back as bare file attachments because the endpoint
            // that would order them isn't deployed.
            photoData && photoData.ordered === false ? (
              <Alert variant="warning">
                <p className="font-bold">These don’t reach customers yet</p>
                <p className="mt-1">
                  Photos you add here upload properly and attach to this venue, so our reviewers
                  see them. The app has no place to show a venue’s pictures yet, so they won’t
                  appear in search, and the order below isn’t saved. We’ve asked for it.
                </p>
              </Alert>
            ) : null
          }
        />
      </Card>

      <Card
        title="Moods"
        action={<span className="text-xs text-ink-500">{form.moods.length} selected</span>}
      >
        {loadingMoods ? (
          <Spinner />
        ) : (
          <>
            <p className="mb-4 text-sm text-ink-500">
              Pick every mood this venue fits. Customers search by mood — this is how they find you.
            </p>
            <div className="flex flex-wrap gap-2">
              {moods.map((mood) => {
                const selected = form.moods.includes(mood.name)
                return (
                  <button
                    key={mood.name}
                    type="button"
                    onClick={() => toggleMood(mood.name)}
                    aria-pressed={selected}
                    className={clsx(
                      'rounded-full px-4 py-1.5 text-sm font-medium ring-1 ring-inset transition',
                      selected
                        ? 'bg-brand-500 text-ink-900 ring-brand-edge'
                        : 'bg-white text-ink-700 ring-gray-300 hover:bg-gray-50',
                    )}
                  >
                    {mood.mood_name}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* Was seven rows of four controls — twenty-eight in a flat list, roughly
          two screens on a phone. The editor now groups consecutive days with
          matching hours, so the usual case is two or three rows, and drops to
          the full per-day list on request for irregular weeks. */}
      <Card title="Operating hours">
        <OperatingHoursEditor
          rows={form.operating_hours}
          onChange={(operating_hours) => setForm((f) => ({ ...f, operating_hours }))}
        />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <p className="text-sm text-ink-500">
          Status on save: <Badge tone="Pending">Pending</Badge>
        </p>
        <Button type="submit" loading={busy}>
          {isEdit ? 'Save and resubmit' : 'Submit for approval'}
        </Button>
      </div>
    </form>
  )
}

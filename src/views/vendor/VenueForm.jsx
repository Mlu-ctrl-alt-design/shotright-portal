import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { minutesSinceMidnight } from '../../utils/time'
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
import {
  MAX_VENUE_PHOTOS,
  UPDATE_VENUE_METHOD,
  moodKeysOf,
  uploadVenuePhoto,
} from '../../services/vendor'
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
  const updateVenue = useUpdateVenue(venueId, existing)

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

  /**
   * Seed the form from the venue — and resolve its moods to the ids the
   * checkboxes are keyed on.
   *
   * ⚠️ Reported 8 Aug: "unable to save because the moods are throwing an
   * error." This was it, and there was no server error involved.
   *
   * `moods` is a child table, so it arrives as ids, as child rows, or as
   * labels depending on which endpoint answered — and after a
   * `get_venue_detail` 404 (§0) it arrives from the dashboard row instead,
   * which need not match either. This line used to be `existing.moods || []`
   * and the checkboxes matched on `includes(mood.name)`, so any shape but a
   * flat list of docnames selected NOTHING. The partner then hit the form's own
   * "select at least one mood" rule and could not save a venue they had not
   * touched the moods of.
   *
   * Matching is by docname first, then by label, case-insensitively. A key we
   * cannot resolve is KEPT rather than dropped: an unknown mood is a mood we
   * do not understand, not a mood the venue does not have, and dropping it here
   * would quietly propose deleting it on the next save.
   */
  useEffect(() => {
    if (!existing) return
    const byKey = new Map()
    for (const mood of moods) {
      if (mood?.name) byKey.set(String(mood.name).toLowerCase(), mood.name)
      if (mood?.mood_name) byKey.set(String(mood.mood_name).toLowerCase(), mood.name)
    }
    const resolved = moodKeysOf(existing.moods).map(
      (key) => byKey.get(String(key).toLowerCase()) || key,
    )

    setForm({
      ...EMPTY,
      ...existing,
      moods: [...new Set(resolved)],
      operating_hours: existing.operating_hours?.length ? existing.operating_hours : blankHours(),
    })
  }, [existing, moods])

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
    /**
     * ⚠️ Compared as MINUTES, not as strings.
     *
     * This was `h.open_time >= h.close_time`, and Frappe does not zero-pad the
     * hour of a Time field — so a venue opening at nine and closing at eleven
     * arrived as "9:00:00" and "23:00:00", and `"9" > "2"` made the string
     * comparison say closing came first. Every venue opening before ten
     * o'clock was refused the save, on a form that gave no way to argue.
     *
     * A row we cannot read at all is NOT treated as backwards: refusing a save
     * because of a value the partner never typed and cannot see is the same
     * mistake in a different coat.
     */
    const badRow = openDays.find((h) => {
      const open = minutesSinceMidnight(h.open_time)
      const close = minutesSinceMidnight(h.close_time)
      return open !== null && close !== null && open >= close
    })
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

      /**
       * After the venue, because a photo order is meaningless without the venue
       * it orders. A failure here must not read as "your venue didn't save" —
       * it didn't fail, and the photos are on the bench either way.
       *
       * ⚠️ This used to swallow the outcome entirely, on the reasoning that the
       * Photos card had already warned them. It hadn't: that notice only shows
       * when the READ falls back, so a bench where the read works and the SAVE
       * doesn't said nothing at all. The partner saw "Saved", came back, and
       * found their ordering gone with no explanation — which is most of what
       * "the images don't persist" felt like from the outside.
       *
       * The create path has reported this since day one. The edit path is the
       * one people actually use twice.
       */
      const photoWarnings = []
      if (photos.length) {
        try {
          const outcome = await savePhotos.mutateAsync(photos)
          if (outcome && outcome.saved === false) {
            photoWarnings.push(
              outcome.mismatch
                ? `Your photos uploaded, but the app only kept ${outcome.mismatch.stored} of ` +
                    `${outcome.mismatch.sent}. Nothing has been lost.`
                : `Your photos uploaded and are attached to this venue, but the order you put ` +
                    `them in isn’t saved yet — the app has nowhere to keep it. Nothing has been ` +
                    `lost, and it’ll stick as soon as that lands.`,
            )
          }
        } catch (err) {
          photoWarnings.push(
            `Your venue saved, but the photos didn’t go through — ${
              err?.message || 'the server refused them'
            }. Nothing else you changed was affected.`,
          )
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
      const allWarnings = [...(result?.warnings || []), ...photoWarnings]
      if (allWarnings.length) {
        setWarnings(allWarnings)
        setSavedVenue(saved)
        if (saved?.venue_name) setForm((f) => ({ ...f, venue_name: saved.venue_name }))
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }

      navigate(`/venues/${saved.name}/menu`)
    } catch (err) {
      setError(
        isMethodMissing(err, UPDATE_VENUE_METHOD)
          ? `We can’t save changes to this venue just yet. Nothing you typed has been lost, ` +
            `and your venue is exactly as it was. Please try again a bit later.`
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
            /* Known BEFORE they start, from the read. Two different problems
               that used to render as the same empty box — see `getVenuePhotos`.

               `readable: false` is the one behind "my photos didn't persist":
               the read failed, so we show nothing, and a partner who added six
               photos yesterday opens this and finds an empty uploader. Nothing
               was lost. Saying so is the entire fix available to us until the
               endpoint lands.

               Both can be true at once and both matter, so they stack rather
               than one winning. "We can't read them back" and "the order isn't
               kept" are different problems with different consequences, and a
               partner told only the second still thinks last week's six photos
               were deleted. */
            <>
              {photoData?.readable === false && (
                <Alert variant="warning">
                  <p className="font-bold">We can’t show you the photos already on this venue</p>
                  <p className="mt-1">
                    They aren’t lost — the app just can’t read them back from the server yet, so
                    this box starts empty even if you’ve added photos before.{' '}
                    <strong>Anything you add here is uploaded and kept.</strong> If you’d rather
                    not risk duplicates, come back to this a bit later.
                  </p>
                </Alert>
              )}
              {photoData?.ordered === false && (
                <Alert variant="warning">
                  <p className="font-bold">These don’t reach customers yet</p>
                  <p className="mt-1">
                    Photos you add here upload properly and attach to this venue, so our reviewers
                    see them. The app has no place to show a venue’s pictures yet, so they won’t
                    appear in search, and the order below isn’t saved yet.
                  </p>
                </Alert>
              )}
            </>
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

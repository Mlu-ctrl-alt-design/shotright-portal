import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  useCreateVenue,
  useSubmitVenueForReview,
  useVenuePhotoSupport,
} from '../../../hooks/useVendor'
import { useSmartDefaults } from '../../../hooks/useSmartDefaults'
import { useDraft, useSetupDraft } from '../../../hooks/useSetupDraft'
import { useLegalStanding } from '../../../hooks/useLegalStanding'
import { useFeature } from '../../../hooks/usePlan'
import { WIZARD_STEPS } from '../../../services/wizardSteps'
import { FEATURE, isPaywalled } from '../../../services/plan'
import { availableSources, hasSingleVenueSource } from '../../../services/venueSources'
import { FIELD_SECTION, firstInvalid, validateSection } from '../../../services/venueValidation'
import { splitName } from '../../../services/profile'
import { Alert, Button } from '../../../components/ui'
import Spinner from '../../../components/ui/Spinner'
import ProgressRail, { ProgressStrip } from '../../../components/wizard/ProgressRail'
import ImportPanel from '../../../components/venue/ImportPanel'
import UpgradeDialog from '../../../components/paywall/UpgradeDialog'
import VenueDetailsPage, { assembleSummary } from './VenueDetailsPage'
import VenuePhotosPage from './VenuePhotosPage'
import WizardSuccess from './WizardSuccess'

/**
 * Adding a venue: import → one page → photos.
 *
 * ⚠️ THIS REPLACED THE FIVE-STEP WIZARD on 17 Sep. What was mood → details →
 * hours → menu → review is now:
 *
 *   1. IMPORT     one question, nothing else on screen: is your venue already
 *                 on Google, Facebook or your own website? Picking a listing
 *                 fills most of the form. Skipping is one click and is never
 *                 the smaller option.
 *   2. THE FORM   one scrolling page, six labelled sections, a rail that ticks
 *                 as they fill. The complaint this answers was not "too many
 *                 screens" — it was not knowing how much was left.
 *   3. PHOTOS     alone, after everything else is saved. Better taken standing
 *                 in the room than remembered at a desk.
 *
 * The menu left onboarding entirely. It does not hold up going live, and having
 * it in the middle of the flow said that it did.
 *
 * SCREEN 1 IS CONDITIONAL, and this is the part most likely to surprise
 * somebody reading this later: it only appears if the bench can actually serve
 * at least one single-venue import route. Today it cannot — `search_places` is
 * not deployed and the URL importer has not been written — so on the live bench
 * partners go straight to the form, exactly as they do now. An import screen
 * whose every route is dead would be the worst screen in the product: it costs
 * a click, promises a shortcut, and delivers nothing. See `venueSources.js`.
 */

const INITIAL_DETAILS = {
  venue_name: '',
  /* ONE field, split into manager_name / manager_surname on the way out —
     see `buildPayload`. The form asks for a person, not two halves of one. */
  manager: '',
  contact_number: '',
  address: '',
  latitude: undefined,
  longitude: undefined,
  dress_code: '',
}

const INITIAL_HOURS = {
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekendStartsFriday: false,
  weekday: { start: '11:00', end: '23:00' },
  weekend: { start: '11:00', end: '23:00' },
  publicHoliday: { start: '11:00', end: '23:00' },
}

const INITIAL_ANSWERS = { known: '', night: '', who: '' }

/**
 * The loader half.
 *
 * A draft is resolved BEFORE the page mounts, and handed in as initial state.
 * The obvious alternative — mount empty, then patch the draft in from an effect
 * — does not work here, and failed exactly as you would expect: smart defaults
 * also write into `details` on mount, from a snapshot taken before the patch,
 * so a restored venue name was silently wiped a tick after it appeared. There
 * is no ordering of those two effects that is safe, so the draft is not an
 * effect.
 *
 * `key` on the inner component means changing drafts remounts rather than
 * trying to reconcile one partner's half-finished venue into another's.
 */
export default function VenueWizard() {
  const [params] = useSearchParams()
  const resumeId = params.get('draft')
  const { data: draft, isLoading, error } = useDraft(resumeId)

  if (resumeId && isLoading) return <Spinner label="Picking up where you left off…" />

  return (
    <AddVenue
      key={resumeId || 'new'}
      resumeId={resumeId}
      draft={draft || null}
      draftError={resumeId && !isLoading && !draft ? error || new Error('missing') : null}
    />
  )
}

function AddVenue({ resumeId, draft, draftError }) {
  const navigate = useNavigate()
  const saved = draft?.payload || {}

  // Spread over the initial shapes rather than replacing them, so a draft
  // written before a field existed still opens instead of putting an undefined
  // into a controlled input.
  const [details, setDetails] = useState(() => ({ ...INITIAL_DETAILS, ...(saved.details || {}) }))
  const [moods, setMoods] = useState(() => ({ moods: [], ...(saved.moods || {}) }))
  const [hours, setHours] = useState(() => ({ ...INITIAL_HOURS, ...(saved.hours || {}) }))
  const [answers, setAnswers] = useState(() => ({ ...INITIAL_ANSWERS, ...(saved.answers || {}) }))
  // Photos are already on the bench by the time they reach this state — what is
  // held here is a list of `file_url`s, which is exactly why a draft can carry
  // them across a device and a File object never could.
  const [photos, setPhotos] = useState(() => saved.photos || [])

  /**
   * Which fields came from an imported listing rather than from the partner.
   *
   * Survives into the draft, so a partner resuming tomorrow still sees which
   * values were not theirs — a prefilled field that stops saying "we filled
   * this in, check it" is a field they will publish without reading.
   */
  const [fromImport, setFromImport] = useState(() => saved.fromImport || [])
  const [importSource, setImportSource] = useState(() => saved.importSource || null)
  const [hoursFromImport, setHoursFromImport] = useState(() => saved.hoursFromImport || null)

  const [mapOpen, setMapOpen] = useState(false)
  const [paywall, setPaywall] = useState(false)

  /**
   * Which screen we are on.
   *
   * A RESUMED draft never lands on the import screen: they have already been
   * past it, and offering to fill in a form they have half-filled is offering
   * to overwrite their work.
   *
   * Keyed on `resumeId`, NOT on the draft resolving. A link whose draft has
   * gone still means "I have been here before" — and it is the form, not the
   * import screen, that carries the notice explaining the draft is not coming.
   * Dropping them on the import screen would answer a partner asking where
   * their work went by offering to start them over without a word.
   */
  const [stage, setStage] = useState(() => (resumeId ? saved.stage || 'form' : 'import'))

  /**
   * Which import routes this bench can actually serve. `null` while we ask.
   *
   * The import screen does not render until this answers, and skips itself
   * entirely if nothing single-venue came back. Rendering it first and
   * retracting it is worse than waiting a beat — a screen that appears and
   * vanishes reads as a bug, and this one would do it on every bench in
   * production today.
   */
  const [sources, setSources] = useState(null)
  useEffect(() => {
    let alive = true
    availableSources().then((found) => alive && setSources(found))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (stage !== 'import' || !sources) return
    if (!hasSingleVenueSource(sources)) setStage('form')
  }, [stage, sources])

  /**
   * Smart defaults live HERE, not in the page, for the reason they always have:
   * this component owns the state that must outlive a re-render, and §6
   * requires a touched field to stay excluded for the whole session.
   */
  const defaults = useSmartDefaults({ values: details, onChange: setDetails })

  const importFeature = useFeature(FEATURE.VENUE_IMPORT)
  const bulkFeature = useFeature(FEATURE.BULK_IMPORT)

  /**
   * Can this bench actually accept a photo?
   *
   * `undefined` while the probe is in flight, and the requirement stays OFF
   * until it answers — a gate that engages before the answer arrives flickers a
   * blocker in front of someone who has already uploaded.
   */
  const { data: photosSupported } = useVenuePhotoSupport()
  /**
   * Has an upload actually been REFUSED this session?
   *
   * `photosSupported` probes the READ endpoint, and reading photos and
   * uploading them are different permissions — in production on 13 Aug they
   * were different answers. So the read probe is a weak signal and a real
   * refusal is a strong one: the moment an upload comes back refused, we stop
   * demanding a photo, because the partner now has no way to provide one.
   */
  const [photoUploadRefused, setPhotoUploadRefused] = useState(false)
  const photosRequired = photosSupported !== false && !photoUploadRefused

  /**
   * Which fields the partner has finished with.
   *
   * Validation reports only on touched fields while they are still filling the
   * page — arriving and immediately seeing every empty field in red is an
   * accusation, not help. Pressing Save marks everything touched, so from that
   * point everything outstanding is visible at once.
   */
  const [touched, setTouched] = useState(() => new Set())
  const touchField = (field) => setTouched((prev) => new Set(prev).add(field))

  const [gateError, setGateError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [created, setCreated] = useState(null)
  const pageRef = useRef(null)

  const createVenue = useCreateVenue()
  const submitReview = useSubmitVenueForReview()
  /* Submitting is where a listing enters our review queue and starts heading
     for real customers, so it is where the agreement has to be in place. See
     `ENFORCE_AT` in services/legal.js for why here and not at login. */
  const legal = useLegalStanding()

  /** The slice of state each section validates against. */
  const stateFor = (key) =>
    ({
      basics: details,
      where: details,
      vibe: moods,
      hours,
      words: answers,
      photos: { photos, photosRequired },
    })[key]

  const sections = WIZARD_STEPS.map((step) => ({
    ...step,
    done: Object.keys(validateSection(step.key, stateFor(step.key))).length === 0,
  }))

  /** Everything outstanding, whether or not it has been touched. */
  const allErrors = () =>
    WIZARD_STEPS.reduce(
      (acc, step) => ({ ...acc, ...validateSection(step.key, stateFor(step.key)) }),
      {},
    )

  /** Live errors for the page, limited to what has been touched. */
  const visibleErrors = WIZARD_STEPS.reduce(
    (acc, step) => ({ ...acc, ...validateSection(step.key, stateFor(step.key), touched) }),
    {},
  )

  /**
   * Autosave, so walking away is not the same as starting over.
   *
   * `step` is the first UNFINISHED section rather than a screen, now that there
   * is only one screen to be on. That is a better answer to the dashboard's
   * "how far did I get" than the old one was: it names the next thing to do
   * rather than the last place they stood.
   */
  const firstUnfinished = sections.find((s) => !s.done)
  const draftState = useSetupDraft({
    draftId: resumeId,
    step: firstUnfinished?.key || 'photos',
    completed: sections.filter((s) => s.done).map((s) => s.key),
    venueName: details.venue_name,
    payload: {
      details,
      moods,
      hours,
      answers,
      photos,
      fromImport,
      importSource,
      hoursFromImport,
      stage,
    },
    enabled: !created && stage !== 'import',
  })

  /**
   * Drop the banner as soon as the thing it complains about is fixed.
   *
   * A blocking message that outlives the block is worse than no message: the
   * partner corrects the field, the warning stays put, and they cannot tell
   * whether they are still stuck.
   */
  const outstanding = Object.keys(allErrors()).length + defaults.unconfirmed.length
  useEffect(() => {
    if (outstanding === 0) setGateError(null)
  }, [outstanding])

  /* ------------------------------------------------------------- importing */

  /**
   * A listing was picked. Fill what it gave us and mark every one of it.
   *
   * Google is being used as a KEYBOARD, not as a database — every value stays
   * editable, every one is marked, and only the `place_id` is kept of what
   * Google sent. See the four rules at the top of `places.js`.
   */
  const onImported = (place, source) => {
    const marked = []
    const next = { ...details }

    if (place.name) {
      next.venue_name = place.name
      marked.push('venue_name')
    }
    if (place.address) {
      next.address = place.address
      marked.push('address')
    }
    if (place.phone) {
      next.contact_number = place.phone
      marked.push('contact_number')
    }
    if (place.latitude && place.longitude) {
      next.latitude = place.latitude
      next.longitude = place.longitude
      marked.push('location')
    }
    /* The ONE piece of Google data that is ours to keep, and what lets the
       bench spot a second partner claiming a restaurant that is already
       listed. */
    next.place_id = place.placeId || ''

    /* Everything a listing fills is a value the partner did not type, so none
       of it may be treated as a confirmed smart default. Marking them dirty
       stops the defaults engine reapplying over the top. */
    marked.forEach((field) => defaults.markDirty?.(field))

    setDetails(next)
    setFromImport(marked)
    setImportSource(source)
    setHoursFromImport(describeHours(place.hours))
    setStage('form')
  }

  const skipImport = () => setStage('form')

  /* ----------------------------------------------------------------- gates */

  /**
   * Take the partner to the problem rather than describing where it is.
   *
   * `center` because a field's error message sits BELOW it — scroll to `start`
   * and the reason is off-screen under the fold. `preventScroll` on focus so
   * the browser does not immediately re-scroll and undo that.
   */
  const focusField = (field) => {
    const node = pageRef.current?.querySelector(`[data-field="${field}"]`)
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    node?.focus?.({ preventScroll: true })
  }

  /**
   * Everything that must be true before the form can be left for the photos.
   *
   * ONE gate, not two. Required-field validation and the smart-defaults Tier B
   * confirmation both stop forward movement, so they resolve here together and
   * report through the same banner — two competing mechanisms would let a
   * partner clear one and be stopped again by the other with different styling,
   * which reads as the form moving the goalposts.
   */
  const passesGate = () => {
    const errors = allErrors()
    // Photos are the NEXT screen's job. Blocking entry to the photo screen on
    // having no photos is a locked door with the key behind it.
    delete errors.photos

    const field = firstInvalid(errors)
    if (field) {
      // Reveal everything outstanding at once. Fixing one field only to be
      // stopped by the next is the slowest possible way through a form.
      setTouched((prev) => new Set([...prev, ...Object.keys(errors)]))
      setGateError(errors[field])
      /* A location problem lives inside the collapsed panel, so open it —
         otherwise we scroll someone to a row that does not contain the field
         we are telling them to fix. */
      if (FIELD_SECTION[field] === 'where') setMapOpen(true)
      requestAnimationFrame(() => focusField(field))
      return false
    }

    if (defaults.unconfirmed.length) {
      const COPY = {
        contact_number: 'Please confirm this is the right number for customers to call.',
        map_pin:
          'Please confirm the pin is on your venue — it is currently a rough guess from your device.',
      }
      const pending = defaults.unconfirmed[0]
      setGateError(COPY[pending] || 'Please confirm the highlighted field.')
      /* The pin lives inside the collapsed panel, so open it. Telling somebody
         to confirm a pin they cannot see is the same dead end as a gate with
         no key — see the chip note in VenueDetailsPage. */
      if (pending === 'map_pin') setMapOpen(true)
      requestAnimationFrame(() => focusField(pending))
      return false
    }

    return true
  }

  const toPhotos = async () => {
    if (!passesGate()) return
    setGateError(null)
    /* Banked before they move. The button says "Save and add photos" and this
       is the save — the debounce would get there on its own, but a promise in
       a button label should not be waiting on a timer. */
    await draftState.saveNow?.()
    setStage('photos')
    window.scrollTo({ top: 0 })
  }

  /* ---------------------------------------------------------------- submit */

  /**
   * Flatten everything into the Venue payload.
   *
   * Moods carry their resolution status through unchanged: the backend needs to
   * know which are canonical Moods and which are Mood Suggestions awaiting
   * review (C1), and that distinction is lost if we send bare labels.
   */
  const buildPayload = () => {
    /* One visible field, two backend columns. Split on the FIRST space, which
       is the convention `splitName` already uses for the partner's own profile
       — so "Thabo van der Merwe" keeps its compound surname intact. A
       multi-part FIRST name lands in the surname, which is the lesser error of
       the two available and is correctable on /profile. */
    const { first_name, last_name } = splitName(details.manager)

    return {
      venue_name: details.venue_name,
      manager_name: first_name,
      manager_surname: last_name,
      contact_number: details.contact_number,
      address: details.address,
      latitude: details.latitude,
      longitude: details.longitude,
      dress_code: details.dress_code,
      /**
       * ⚠️ THE DESCRIPTION GOES IN `atmosphere`, NOT `summary`.
       *
       * `create_venue` maps `atmosphere` onto the Venue's `atmosphere_desc`,
       * and `summary` has no home at all — it is one of the fields the service
       * layer warns was not saved. So `summary` is where the old wizard's
       * rich-text description went to die, and `atmosphere` is what the
       * completeness rules actually read when they decide whether this listing
       * has been described.
       *
       * Sending the assembled answers here is also a straight improvement on
       * what it replaces: a sentence the partner wrote about their own venue,
       * rather than "Out door laid back" picked off a dropdown.
       *
       * They have read it back on screen — the "what customers will read" panel
       * exists so this is never a surprise.
       */
      atmosphere: assembleSummary(answers) || details.atmosphere || '',
      /**
       * ⚠️ If `create_venue` does not declare `place_id`, Frappe drops it at
       * 200 and nothing here will say so. Filed as §20; the portal works either
       * way and simply loses the dedupe until the field exists.
       */
      place_id: details.place_id || undefined,
      // Order is data, not decoration: photo one is what a customer sees when
      // this venue comes back from a mood search.
      photos: photos.map((p, index) => ({ ...p, idx: index + 1 })),
      moods: moods.moods.map((m) => ({ mood: m.mood, status: m.status, label: m.label })),
      // Passed raw: the service layer converts these three ranges into the
      // per-day rows the backend stores (C3), and reports what it had to drop.
      operating_hours: hours,
      /* The menu left onboarding on 17 Sep — it does not hold up going live.
         Sent empty so the payload shape is unchanged for the service layer. */
      menu: [],
    }
  }

  const handleSubmit = async () => {
    // A safety net that should never fire: the form was gated before it could
    // be left. If it does fire, it takes the partner back to the field.
    const errors = allErrors()
    const field = firstInvalid(errors)
    if (field) {
      setTouched((prev) => new Set([...prev, ...Object.keys(errors)]))
      if (FIELD_SECTION[field] !== 'photos') setStage('form')
      setSubmitError(errors[field])
      requestAnimationFrame(() => focusField(field))
      return
    }

    /**
     * THE LEGAL GATE — and the reason it is placed AFTER validation.
     *
     * By this point the partner has filled in a whole venue. Sending them away
     * from that without their work being safe would be the single most
     * expensive thing this flow could do, so the draft is written first and
     * only then do we navigate. They come back to `/venues/new?draft=…` with
     * everything where they left it.
     */
    if (legal.blocks) {
      setSubmitError(null)
      await draftState.saveNow?.()
      navigate(`/legal?from=submit&resume=${draftState.id || ''}`)
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      const { venue, warnings } = await createVenue.mutateAsync(buildPayload())
      // Acceptance rate is the health metric for each default (§12) — measured
      // at submit, since that is when "submitted unmodified" becomes true.
      defaults.reportAccepted()
      /**
       * Creation is SAVING; submission is what puts the listing in front of a
       * moderator — split on the bench since 22 Aug, so a flow that stops at
       * create leaves the venue in Draft for ever while promising a review.
       *
       * Never allowed to fail the submission: the venue EXISTS by this line,
       * and a hiccup here dressed as a creation failure would send the partner
       * back to redo work that is already saved.
       */
      let review
      try {
        review = await submitReview.mutateAsync(venue?.name ?? venue?.venue_name)
      } catch (err) {
        review = { asked: true, failed: true, error: err.message }
      }
      setCreated({ venue, warnings, review })
      // The draft has become a Venue. Leaving it behind would put "continue
      // setup" on the dashboard next to the venue it already created, and the
      // partner would reasonably do both.
      draftState.discard()
    } catch (err) {
      /* The bench refused on the paywall — a subscription that lapsed between
         page load and submit, or a feature key the portal got wrong. Show the
         offer rather than a raw validation error nobody can act on. */
      if (isPaywalled(err)) setPaywall(true)
      else setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const restart = () => {
    setCreated(null)
    setDetails(INITIAL_DETAILS)
    setMoods({ moods: [] })
    setHours(INITIAL_HOURS)
    setAnswers(INITIAL_ANSWERS)
    setPhotos([])
    setFromImport([])
    setImportSource(null)
    setHoursFromImport(null)
    setTouched(new Set())
    setStage(hasSingleVenueSource(sources) ? 'import' : 'form')
  }

  if (created) {
    return (
      <WizardSuccess
        venueName={created.venue?.venue_name ?? details.venue_name}
        venueId={created.venue?.name}
        warnings={created.warnings}
        review={created.review}
        onAddAnother={restart}
      />
    )
  }

  const notices = (
    <>
      {/* A draft id that no longer resolves. Said plainly, because the partner
          arrived from a link that promised their work back and is entitled to
          know it is not coming — rather than being dropped on a blank form and
          left to conclude they imagined it. */}
      {draftError && (
        <div className="mb-5">
          <Alert variant="warning">
            We couldn’t find that draft. Venues you’ve already submitted aren’t affected.
          </Alert>
        </div>
      )}

      {/* Autosave, reported honestly. "Saved" only ever appears after a write
          actually succeeded; a failure says so and says what to do about it,
          because a partner who believes their work is safe is the one who
          closes the tab. */}
      {draftState.status === 'error' && (
        <div className="mb-5">
          <Alert variant="warning">
            We couldn’t save your progress: {draftState.error} Don’t close this tab — press Save to
            try again, or finish and send it for review.
          </Alert>
        </div>
      )}

      {/* Said BEFORE the button is pressed, and on BOTH screens — the form
          because that is where the work is, and the photo screen because that
          is where Send for review lives. Being redirected off a finished venue
          is a bad surprise however carefully the work is preserved, and a
          partner who knows what is coming can accept first and submit once. */}
      {legal.blocks && (
        <div className="mb-5">
          <Alert variant="warning">
            <p className="font-bold">One thing before you send this for review</p>
            <p className="mt-1">
              There{legal.outstanding.length === 1 ? ' is a document' : ' are documents'} to accept
              before a venue can go to our reviewers. Everything here is saved —{' '}
              <Link className="underline" to="/legal?from=submit">
                read {legal.outstanding.length === 1 ? 'it' : 'them'} now
              </Link>
              .
            </p>
          </Alert>
        </div>
      )}

      {submitError && (
        <div className="mb-5">
          <Alert variant="danger">{submitError}</Alert>
        </div>
      )}

      {gateError && (
        <div className="mb-5">
          <Alert variant="warning">{gateError}</Alert>
        </div>
      )}
    </>
  )

  return (
    <>
      <div className="rounded-3xl border border-brand-300 bg-white p-6 sm:p-8">
        {stage === 'import' && (
          <ImportStage
            sources={sources}
            importLocked={importFeature.locked}
            bulkLocked={bulkFeature.locked}
            onUnlock={() => setPaywall(true)}
            onImported={onImported}
            onSkip={skipImport}
          />
        )}

        {stage === 'form' && (
          <div className="flex items-start gap-8">
            <div className="min-w-0 flex-1">
              <header>
                <h1 className="text-2xl font-bold text-ink-900">Your venue’s details</h1>
                <p className="mt-1.5 max-w-prose text-sm text-pretty text-ink-700">
                  {fromImport.length
                    ? 'Filled in from your listing. Check the marked fields and add the rest.'
                    : 'The basics, then the vibe and your hours. Photos come after.'}
                </p>
              </header>

              {/* The rail, compacted, for widths where it will not fit beside
                  the form. Same box treatment so it reads as the same object. */}
              <ProgressStrip
                sections={sections}
                className="mt-5 min-[1120px]:hidden"
              />

              <div className="mt-5">{notices}</div>

              <div ref={pageRef}>
                <VenueDetailsPage
                  value={details}
                  onChange={setDetails}
                  moods={moods}
                  onMoodsChange={setMoods}
                  hours={hours}
                  onHoursChange={setHours}
                  answers={answers}
                  onAnswersChange={setAnswers}
                  fromImport={fromImport}
                  onClearImportedField={(field) =>
                    setFromImport((prev) => prev.filter((f) => f !== field))
                  }
                  defaults={defaults}
                  importSource={importSource}
                  errors={visibleErrors}
                  onBlurField={touchField}
                  mapOpen={mapOpen}
                  onToggleMap={() => setMapOpen((open) => !open)}
                  pinProvisional={defaults.pinIsProvisional}
                  onPinMoved={defaults.onPinMoved}
                  hoursFromImport={hoursFromImport}
                  onEditHours={() => setHoursFromImport(null)}
                />
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3.5 border-t border-ink-200 pt-5">
                <Button shape="field" onClick={toPhotos}>
                  Save and add photos
                </Button>
                <Button shape="field" variant="secondary" onClick={() => navigate('/')}>
                  Finish later
                </Button>
                <SaveState status={draftState.status} />
              </div>
            </div>

            <ProgressRail sections={sections} className="hidden min-[1120px]:block" />
          </div>
        )}

        {stage === 'photos' && (
          <div ref={pageRef}>
            {notices}
            <VenuePhotosPage
              photos={photos}
              onChange={setPhotos}
              required={photosRequired}
              error={visibleErrors.photos}
              onUploadRefused={() => setPhotoUploadRefused(true)}
              onBack={() => setStage('form')}
              onSubmit={() => {
                setTouched((prev) => new Set(prev).add('photos'))
                handleSubmit()
              }}
              onFinishLater={() => navigate('/')}
              submitting={submitting}
              venueName={details.venue_name}
            />
          </div>
        )}
      </div>

      <UpgradeDialog open={paywall} onClose={() => setPaywall(false)} />
    </>
  )
}

/* ------------------------------------------------------------ the import screen */

/**
 * Screen one: a single decision, with nothing competing for it.
 *
 * No form, no progress rail, no footer. The moment this screen carries a second
 * thing to do, it stops being a shortcut and becomes another step.
 */
function ImportStage({ sources, importLocked, bulkLocked, onUnlock, onImported, onSkip }) {
  if (!sources) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Spinner label="Just a moment…" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="text-2xl font-bold text-ink-900">Start with your existing listing</h1>
        <p className="mt-1.5 max-w-prose text-sm text-pretty text-ink-700">
          One search and the form is mostly filled in. You check it and add what only you know.
        </p>
      </header>

      <div className="mt-7">
        <ImportPanel
          sources={sources}
          importLocked={importLocked}
          bulkLocked={bulkLocked}
          onUnlock={onUnlock}
          onImported={onImported}
        />
      </div>

      {/* Never the smaller option in substance, even though it is quieter in
          weight: a venue that is not on Google — new, home-run, a pop-up — must
          not feel like a second-class listing. */}
      <button
        type="button"
        onClick={onSkip}
        className="mt-5 text-[13px] font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900"
      >
        Skip — I’ll type it in myself
      </button>
    </div>
  )
}

/** "Saved as you type", and only when it is true. */
function SaveState({ status }) {
  if (status !== 'saved' && status !== 'saving') return null
  return (
    <p className="ml-auto flex items-center gap-1.5 text-xs text-ink-500" role="status">
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="size-4 fill-none stroke-current stroke-[1.75]"
      >
        <path d="M5.5 15.5a3.5 3.5 0 0 1-.4-6.98 5 5 0 0 1 9.76-1.4A3.75 3.75 0 0 1 15 15.5Z" strokeLinejoin="round" />
        {status === 'saved' && <path d="m8 11 1.75 1.75L13 9.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {status === 'saved' ? 'Saved as you type' : 'Saving…'}
    </p>
  )
}

/**
 * Turn whatever hours the importer sent into one line a partner can check.
 *
 * ⚠️ We do NOT parse them into the form. Getting seven days subtly wrong writes
 * bad trading hours onto a real business, and a partner who trusts the prefill
 * will not re-read all seven — so the imported hours are SHOWN, with a Change
 * that hands them the editor, and the form's own values are what get saved
 * until they say otherwise. See the same reasoning in `places.js`.
 */
function describeHours(rows) {
  if (!Array.isArray(rows) || !rows.length) return null
  const open = rows.filter((r) => !r.closed && r.open_time && r.close_time)
  if (!open.length) return null
  const short = (t) => String(t).slice(0, 5)
  return open
    .slice(0, 3)
    .map((r) => `${String(r.day_of_week || '').slice(0, 3)} ${short(r.open_time)}–${short(r.close_time)}`)
    .join(' · ')
}

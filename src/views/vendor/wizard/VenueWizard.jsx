import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateVenue } from '../../../hooks/useVendor'
import { useSmartDefaults } from '../../../hooks/useSmartDefaults'
import {
  FIELD_STEP,
  firstInvalid,
  validateStep,
} from '../../../services/venueValidation'
import WizardLayout from '../../../components/wizard/WizardLayout'
import { Alert } from '../../../components/ui'
import MoodStep from './steps/MoodStep'
import VenueDetailsStep from './steps/VenueDetailsStep'
import MenuStep from './steps/MenuStep'
import ReviewStep from './steps/ReviewStep'
import WizardSuccess from './WizardSuccess'
import OperatingHoursStep from './steps/OperatingHoursStep'

/**
 * The five-step venue setup wizard.
 *
 * Step labels and order are taken verbatim from the progress rail in the
 * designs. All five steps are built; SUBMIT on the last one creates the Venue,
 * which always enters review rather than going live (#15).
 */
const STEPS = [
  { key: 'mood', label: 'Setup Mood' },
  { key: 'details', label: "Your venue's details" },
  { key: 'hours', label: 'Your operating hours' },
  { key: 'menu', label: 'Your menu options' },
  { key: 'review', label: 'Almost done' },
]

const INITIAL_DETAILS = {
  venue_name: '',
  manager_name: '',
  manager_surname: '',
  contact_number: '',
  address: '',
  latitude: undefined,
  longitude: undefined,
  dress_code: '',
  atmosphere: '',
  summary: '',
}

const INITIAL_HOURS = {
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekendStartsFriday: false,
  weekday: { start: '09:00', end: '20:00' },
  weekend: { start: '09:00', end: '21:00' },
  publicHoliday: { start: '10:00', end: '19:00' },
}

export default function VenueWizard() {
  const navigate = useNavigate()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [completed, setCompleted] = useState([])
  const [moods, setMoods] = useState({ moods: [] })
  const [details, setDetails] = useState(INITIAL_DETAILS)
  const [hours, setHours] = useState(INITIAL_HOURS)
  const [menu, setMenu] = useState({ categories: [] })

  /**
   * Smart defaults live HERE, not in the step.
   *
   * Steps unmount when you navigate between them, so dirty flags held inside
   * VenueDetailsStep would reset on every visit and the defaults would re-apply
   * over the partner's edits. Spec §6 requires a touched field to stay excluded
   * for the whole session, and §9 calls re-entry after a validation failure the
   * most common bug in this pattern — both are the same requirement.
   */
  const defaults = useSmartDefaults({ values: details, onChange: setDetails })
  const [gateError, setGateError] = useState(null)
  const stepRef = useRef(null)

  /**
   * Which fields the partner has finished with, per step.
   *
   * Validation reports only on touched fields while they are still filling the
   * form — arriving on a step and immediately seeing every empty field in red
   * is an accusation, not help. Pressing Next marks the whole step touched, so
   * from that point everything outstanding is visible at once.
   */
  const [touched, setTouched] = useState({})
  const touchedFor = (key) => touched[key] || new Set()
  const touchField = (stepKey, field) =>
    setTouched((prev) => ({
      ...prev,
      [stepKey]: new Set(prev[stepKey] || []).add(field),
    }))

  const stateFor = (key) =>
    ({ mood: moods, details, hours, menu, review: null })[key]


  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [created, setCreated] = useState(null)
  const createVenue = useCreateVenue()

  const step = STEPS[currentIndex]
  const isLast = currentIndex === STEPS.length - 1

  /** Live errors for the step being shown, limited to what has been touched. */
  const visibleErrors = validateStep(step.key, stateFor(step.key), touchedFor(step.key))

  /**
   * Drop the banner as soon as the thing it complains about is fixed.
   *
   * A blocking message that outlives the block is worse than no message: the
   * partner corrects the field, the warning stays put, and they cannot tell
   * whether they are still stuck. Keyed on the actual outstanding problems
   * rather than on any single interaction, so it clears however they fixed it.
   */
  const outstanding =
    Object.keys(validateStep(step.key, stateFor(step.key))).length +
    (step.key === 'details' ? defaults.unconfirmed.length : 0)

  useEffect(() => {
    if (outstanding === 0) setGateError(null)
  }, [outstanding])

  const markComplete = (index) =>
    setCompleted((prev) => (prev.includes(index) ? prev : [...prev, index]))

  /**
   * Flatten wizard state into the Venue payload.
   *
   * Moods carry their resolution status through unchanged: the backend needs to
   * know which are canonical Moods and which are Mood Suggestions awaiting
   * review (C1), and that distinction is lost if we send bare labels.
   */
  const buildPayload = () => ({
    venue_name: details.venue_name,
    manager_name: details.manager_name,
    manager_surname: details.manager_surname,
    contact_number: details.contact_number,
    address: details.address,
    latitude: details.latitude,
    longitude: details.longitude,
    dress_code: details.dress_code,
    atmosphere: details.atmosphere,
    summary: details.summary,
    moods: moods.moods.map((m) => ({ mood: m.mood, status: m.status, label: m.label })),
    // Passed raw: the service layer converts these three ranges into the
    // per-day rows the backend stores (C3), and reports what it had to drop.
    operating_hours: hours,
    menu: menu.categories.map((c) => ({
      heading: c.name,
      items: c.items.map((i) => ({
        item_name: i.name,
        price: i.price,
        description: i.details,
        image: i.image || null,
      })),
    })),
  })

  const handleSubmit = async () => {
    // A safety net that should never fire: every step was validated before it
    // could be left. If it does fire, it names the step AND jumps to it rather
    // than telling the partner where to go and leaving them to walk.
    for (const s of STEPS) {
      const errors = validateStep(s.key, stateFor(s.key))
      const field = firstInvalid(errors)
      if (!field) continue
      setCurrentIndex(STEPS.findIndex((x) => x.key === (FIELD_STEP[field] || s.key)))
      setTouched((prev) => ({
        ...prev,
        [s.key]: new Set([...(prev[s.key] || []), ...Object.keys(errors)]),
      }))
      setSubmitError(errors[field])
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      const { venue, warnings } = await createVenue.mutateAsync(buildPayload())
      // Acceptance rate is the health metric for each default (§12) — measured
      // at submit, since that is when "submitted unmodified" becomes true.
      defaults.reportAccepted()
      markComplete(currentIndex)
      setCreated({ venue, warnings })
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Everything that must be true before this step can be left.
   *
   * ONE gate, not two. Required-field validation and the smart-defaults Tier B
   * confirmation both stop forward movement, so they resolve here together and
   * report through the same banner — two competing mechanisms would let a
   * partner clear one and be stopped again by the other with different styling,
   * which reads as the form moving the goalposts.
   *
   * Validation runs first: an unconfirmed guess matters less than a missing
   * required value, and fixing the required value often clears the guess too.
   *
   * Returns true when it is safe to proceed.
   */
  const passesGate = () => {
    const errors = validateStep(step.key, stateFor(step.key))
    const field = firstInvalid(errors)

    if (field) {
      // Reveal everything outstanding at once. Fixing one field only to be
      // stopped by the next is the slowest possible way through a form.
      setTouched((prev) => ({
        ...prev,
        [step.key]: new Set([...(prev[step.key] || []), ...Object.keys(errors)]),
      }))
      setGateError(errors[field])
      focusField(field)
      return false
    }

    if (step.key === 'details' && defaults.unconfirmed.length) {
      const COPY = {
        contact_number: 'Please confirm this is the right number for customers to call.',
        map_pin:
          'Please confirm the pin is on your venue — it is currently a rough guess from your device.',
      }
      const pending = defaults.unconfirmed[0]
      setGateError(COPY[pending] || 'Please confirm the highlighted field.')
      focusField(pending)
      return false
    }

    return true
  }

  /**
   * Take the partner to the problem rather than describing where it is.
   *
   * `center` because a field's error message and any chip sit BELOW it — scroll
   * to `start` and the reason is off-screen under the fold. `preventScroll` on
   * focus so the browser does not immediately re-scroll and undo that.
   */
  const focusField = (field) => {
    const node = stepRef.current?.querySelector(`[data-field="${field}"]`)
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    node?.focus?.({ preventScroll: true })
  }

  const handleNext = () => {
    if (!passesGate()) return
    setGateError(null)
    markComplete(currentIndex)
    if (isLast) return handleSubmit()
    setCurrentIndex((i) => i + 1)
  }

  const handlePrevious = () => setCurrentIndex((i) => Math.max(0, i - 1))
  const handleCancel = () => navigate('/')

  const restart = () => {
    setCreated(null)
    setCompleted([])
    setCurrentIndex(0)
    setMoods({ moods: [] })
    setDetails(INITIAL_DETAILS)
    setHours(INITIAL_HOURS)
    setMenu({ categories: [] })
  }

  if (created) {
    return (
      <WizardSuccess
        venueName={created.venue?.venue_name ?? details.venue_name}
        warnings={created.warnings}
        onAddAnother={restart}
      />
    )
  }

  const COPY = {
    mood: {
      title: 'Chisa! Begin your journey',
      subtitle: 'Please ADD NEW desired venue to the Bloop app.',
    },
    details: {
      title: "Enter your venue's details",
      subtitle: 'Please ADD the details of the venue you are listing.',
    },
    hours: {
      title: 'Enter your operating hours',
      subtitle: 'Please ADD operating hours which your business operates.',
    },
    menu: {
      title: 'Enter your menu',
      subtitle: 'Please ADD menu category and menu items.',
    },
    review: {
      title: 'Almost done, mood summary details',
      subtitle: 'Check everything over before you submit.',
    },
  }

  const renderStep = () => {
    switch (step.key) {
      case 'hours':
        return <OperatingHoursStep value={hours} onChange={setHours} errors={visibleErrors} />
      case 'mood':
        return <MoodStep value={moods} onChange={setMoods} errors={visibleErrors} />
      case 'details':
        return (
          <VenueDetailsStep
            value={details}
            onChange={setDetails}
            defaults={defaults}
            errors={visibleErrors}
            onBlurField={(field) => touchField('details', field)}
          />
        )
      case 'menu':
        return <MenuStep value={menu} onChange={setMenu} />
      case 'review':
        return <ReviewStep moods={moods} details={details} hours={hours} menu={menu} />
      default:
        return null
    }
  }

  return (
    <WizardLayout
      title={COPY[step.key].title}
      subtitle={COPY[step.key].subtitle}
      steps={STEPS}
      currentIndex={currentIndex}
      completed={completed}
      onStepClick={(index) => {
        // Backwards is always free — someone going back to fix something must
        // never be stopped by the thing they are going back to fix. Forwards
        // takes the same gate as Next.
        if (index <= currentIndex || passesGate()) {
          setGateError(null)
          setCurrentIndex(index)
        }
      }}
      onCancel={handleCancel}
      onPrevious={handlePrevious}
      onNext={handleNext}
      nextLabel={isLast ? 'Submit' : 'Next'}
      nextLoading={submitting}
    >
      {submitError && (
        <div className="mb-5">
          <Alert variant="danger">{submitError}</Alert>
        </div>
      )}
      {/* The Tier B block. `role="alert"` so it is announced the moment it
          appears — someone who pressed Next and did not move needs telling
          why, and the field it scrolled to is off-screen for a keyboard user
          who has not followed the scroll. */}
      {gateError && (
        <div className="mb-5">
          <Alert variant="warning">{gateError}</Alert>
        </div>
      )}
      <div ref={stepRef}>{renderStep()}</div>
    </WizardLayout>
  )
}

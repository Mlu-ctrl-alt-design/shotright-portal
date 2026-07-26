import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateVenue } from '../../../hooks/useVendor'
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

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [created, setCreated] = useState(null)
  const createVenue = useCreateVenue()

  const step = STEPS[currentIndex]
  const isLast = currentIndex === STEPS.length - 1

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
    if (!details.venue_name.trim()) {
      setSubmitError('Your venue needs a name — add one on “Your venue’s details”.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { venue, warnings } = await createVenue.mutateAsync(buildPayload())
      markComplete(currentIndex)
      setCreated({ venue, warnings })
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleNext = () => {
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
        return <OperatingHoursStep value={hours} onChange={setHours} />
      case 'mood':
        return <MoodStep value={moods} onChange={setMoods} />
      case 'details':
        return <VenueDetailsStep value={details} onChange={setDetails} />
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
      onStepClick={setCurrentIndex}
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
      {renderStep()}
    </WizardLayout>
  )
}

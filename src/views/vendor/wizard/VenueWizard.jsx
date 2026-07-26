import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import WizardLayout from '../../../components/wizard/WizardLayout'
import MoodStep from './steps/MoodStep'
import VenueDetailsStep from './steps/VenueDetailsStep'
import OperatingHoursStep from './steps/OperatingHoursStep'
import PendingStep from './steps/PendingStep'

/**
 * The five-step venue setup wizard.
 *
 * Step labels and order are taken verbatim from the progress rail in the
 * designs. The chrome (rail, ticks, Cancel/Previous/Next, back-navigation to
 * visited steps) is complete; step bodies still blocked on the conflicts in
 * docs/PRD-shot-right-partner-portal.md §7.5 render a PendingStep that names
 * the blocker.
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

  const step = STEPS[currentIndex]
  const isLast = currentIndex === STEPS.length - 1

  const markComplete = (index) =>
    setCompleted((prev) => (prev.includes(index) ? prev : [...prev, index]))

  const handleNext = () => {
    markComplete(currentIndex)
    if (isLast) {
      // Submission lands here once the doctypes exist (PRD §7.3).
      return
    }
    setCurrentIndex((i) => i + 1)
  }

  const handlePrevious = () => setCurrentIndex((i) => Math.max(0, i - 1))
  const handleCancel = () => navigate('/')

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
        return (
          <PendingStep
            blockedBy="conflict C4 — menu item images and rich text"
            summary="Menu items carry an image and a rich-text description, and each category has its own Excel upload plus a downloadable template. Needs file storage and an upload policy first."
            screens={['add a menu.png', 'menu items loaded.png', 'edit a menu item.png']}
          />
        )
      case 'review':
        return (
          <PendingStep
            blockedBy="the four steps above"
            summary="The review screen reflects whatever the earlier steps captured, so it is built last. Layout is settled: mood pills, a tinted venue summary panel, the three hour ranges, and one expandable section per menu category."
            screens={['venue summary screen.png']}
          />
        )
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
      nextDisabled={isLast}
    >
      {renderStep()}
    </WizardLayout>
  )
}

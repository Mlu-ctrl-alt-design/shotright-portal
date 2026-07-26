import { DayChip, Toggle, Input } from '../../../../components/ui'

/**
 * Wizard step 3 — operating hours.
 *
 * The designs model hours as three ranges (week day / weekend / public holiday)
 * plus a movable weekend boundary, NOT as seven per-day rows. See conflict C3
 * in docs/PRD-shot-right-partner-portal.md: the UI here is unambiguous, but the
 * doctype that persists it is still undecided, so this step holds its values in
 * wizard state and does not save yet.
 */
const DAYS = [
  { key: 'sun', label: 'SUN' },
  { key: 'mon', label: 'MON' },
  { key: 'tue', label: 'TUES' },
  { key: 'wed', label: 'WED' },
  { key: 'thu', label: 'THUR' },
  { key: 'fri', label: 'FRI' },
  { key: 'sat', label: 'SAT' },
]

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 fill-none stroke-current stroke-[1.75]">
      <circle cx="10" cy="10" r="7.75" />
      <path d="M10 5.5V10l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HourRange({ heading, hint, value, onChange }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-ink-900">{heading}</h2>
      <p className="mt-0.5 text-sm text-ink-700">{hint}</p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <Input
          type="time"
          aria-label={`${heading} start time`}
          value={value.start}
          onChange={(e) => onChange({ ...value, start: e.target.value })}
          trailing={<ClockIcon />}
        />
        <Input
          type="time"
          aria-label={`${heading} end time`}
          value={value.end}
          onChange={(e) => onChange({ ...value, end: e.target.value })}
          trailing={<ClockIcon />}
        />
      </div>
    </section>
  )
}

export default function OperatingHoursStep({ value, onChange }) {
  const toggleDay = (key) => {
    const days = value.days.includes(key)
      ? value.days.filter((d) => d !== key)
      : [...value.days, key]
    onChange({ ...value, days })
  }

  return (
    <div className="space-y-9">
      <section>
        <p className="text-sm text-ink-700">Select days of operation</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {DAYS.map((day) => (
            <DayChip
              key={day.key}
              label={day.label}
              selected={value.days.includes(day.key)}
              onClick={() => toggleDay(day.key)}
            />
          ))}
        </div>
        <div className="mt-5">
          <Toggle
            label="Weekend starts FRIDAY"
            checked={value.weekendStartsFriday}
            onChange={(weekendStartsFriday) => onChange({ ...value, weekendStartsFriday })}
          />
        </div>
      </section>

      <HourRange
        heading="Week day hours"
        hint="Please set start and end time for the week."
        value={value.weekday}
        onChange={(weekday) => onChange({ ...value, weekday })}
      />
      <HourRange
        heading="Weekend hours"
        hint="Please set start and end time for the weekend."
        value={value.weekend}
        onChange={(weekend) => onChange({ ...value, weekend })}
      />
      <HourRange
        heading="Public holiday hours"
        hint="Please set start and end time."
        value={value.publicHoliday}
        onChange={(publicHoliday) => onChange({ ...value, publicHoliday })}
      />
    </div>
  )
}

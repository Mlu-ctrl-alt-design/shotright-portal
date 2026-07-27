import { DayChip, Toggle, Input } from '../../../../components/ui'
import { clsx } from '../../../../utils/clsx'

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

function HourRange({ heading, hint, value, onChange, error, field }) {
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
          error={error}
          data-field={field}
        />
      </div>
    </section>
  )
}

export default function OperatingHoursStep({ value, onChange, errors = {} }) {
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
        <div
          data-field="days"
          tabIndex={-1}
          className={clsx(
            'mt-4 flex flex-wrap gap-3 rounded-3xl',
            // Ringed rather than bordered: the chips already have their own
            // outlines and a second border directly around them reads as a
            // nested control instead of an error state.
            errors.days && 'p-3 ring-2 ring-red-700',
          )}
        >
          {DAYS.map((day) => (
            <DayChip
              key={day.key}
              label={day.label}
              selected={value.days.includes(day.key)}
              onClick={() => toggleDay(day.key)}
            />
          ))}
        </div>
        {errors.days && (
          <p className="mt-2 px-1 text-xs font-medium text-red-700" role="alert">
            {errors.days}
          </p>
        )}

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
        error={errors.weekday}
        field="weekday"
      />
      <HourRange
        heading="Weekend hours"
        hint="Please set start and end time for the weekend."
        value={value.weekend}
        onChange={(weekend) => onChange({ ...value, weekend })}
        error={errors.weekend}
        field="weekend"
      />
      <HourRange
        heading="Public holiday hours"
        hint="Please set start and end time."
        value={value.publicHoliday}
        onChange={(publicHoliday) => onChange({ ...value, publicHoliday })}
        error={errors.publicHoliday}
        field="publicHoliday"
      />
    </div>
  )
}

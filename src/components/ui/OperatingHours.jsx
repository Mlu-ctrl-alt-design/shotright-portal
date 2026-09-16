import { useMemo, useState } from 'react'
import { clsx } from '../../utils/clsx'
import { formatTime, toTimeInput } from '../../utils/time'

/**
 * Operating hours, as bands rather than seven rows.
 *
 * THE PROBLEM: the editor rendered one row per day, each with a day label, an
 * opening time, a closing time and a Closed checkbox. Twenty-eight controls in
 * a flat list. On a phone that grid collapses to a single column, so it becomes
 * roughly two full screens of scrolling to say "we're open 9 to 10, closed
 * Mondays" — and every row looks identical, so it is genuinely hard to check
 * you got it right.
 *
 * THE FIX: consecutive days sharing the same hours collapse into one band —
 * "Mon – Fri · 09:00 – 22:00". That is how opening hours are written on a door,
 * on Google, and in every partner's head. Seven rows become two or three, and
 * editing a band edits every day in it at once, so the common case is two
 * inputs rather than fourteen.
 *
 * Grouping is DISPLAY ONLY. The underlying data stays one row per day, which is
 * what the backend stores and what a venue with genuinely irregular hours
 * needs. `Edit day by day` drops to the full list for exactly that case — it is
 * not a fallback, it is the escape hatch that makes the summary safe to default
 * to. Anything the per-day editor produces still renders correctly above; it
 * just yields more bands.
 *
 * Bands are built from CONSECUTIVE days only. Grouping non-adjacent days would
 * produce "Mon, Wed, Fri – Sat" strings that are harder to read than the list
 * they replaced, and would misrepresent a week at a glance.
 */

export const DAY_ORDER = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

const SHORT = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
}

/* Times are parsed, never sliced — see `utils/time.js` for the two bugs that
   taught us the difference. Re-exported so callers of this module keep working. */
export { formatTime, toTimeInput }

/**
 * Collapse per-day rows into consecutive bands sharing the same state.
 *
 * Returns `[{days: [...], from, to, closed}]` in week order. Rows are sorted
 * into Mon–Sun first: the backend has no ordering guarantee, and grouping an
 * unsorted list would produce bands that are contiguous in the array but not in
 * the week.
 */
export function groupOperatingHours(rows) {
  const byDay = new Map((rows || []).map((r) => [r.day_of_week, r]))
  const bands = []

  for (const day of DAY_ORDER) {
    const row = byDay.get(day)
    if (!row) continue

    const closed = Boolean(row.closed)
    const from = closed ? null : formatTime(row.open_time)
    const to = closed ? null : formatTime(row.close_time)
    const last = bands[bands.length - 1]

    if (last && last.closed === closed && last.from === from && last.to === to) {
      last.days.push(day)
    } else {
      bands.push({ days: [day], from, to, closed })
    }
  }

  return bands
}

const bandLabel = (days) =>
  days.length === 1
    ? days[0]
    : days.length === 2
      ? `${SHORT[days[0]]} & ${SHORT[days[1]]}`
      : `${SHORT[days[0]]} – ${SHORT[days[days.length - 1]]}`

/**
 * Read-only summary. Used on the venue detail and review screens.
 *
 * A real table rather than divs: this IS tabular data (day against hours), and
 * a screen reader announcing "row: Mon to Fri, 09:00 to 22:00" is the whole
 * point. `<dl>` was the alternative and reads worse for two-column data.
 */
export function OperatingHoursSummary({ rows, className }) {
  const bands = useMemo(() => groupOperatingHours(rows), [rows])

  if (!bands.length) {
    return <p className={clsx('text-sm text-ink-500', className)}>No hours set yet.</p>
  }

  return (
    <table className={clsx('w-full text-sm', className)}>
      <caption className="sr-only">Operating hours</caption>
      <tbody className="divide-y divide-brand-200">
        {bands.map((band) => (
          <tr key={band.days.join()}>
            <th scope="row" className="py-2 pr-4 text-left font-medium whitespace-nowrap text-ink-900">
              {bandLabel(band.days)}
            </th>
            <td
              className={clsx(
                'py-2 text-right tabular-nums',
                band.closed ? 'text-ink-500' : 'text-ink-700',
              )}
            >
              {band.closed ? 'Closed' : `${band.from} – ${band.to}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Editor. Bands by default, per-day on request.
 *
 * `onChange` always receives the full seven-row array — the caller never has to
 * know this component groups anything.
 */
export function OperatingHoursEditor({ rows, onChange }) {
  const [perDay, setPerDay] = useState(false)
  const bands = useMemo(() => groupOperatingHours(rows), [rows])

  const setDays = (days, patch) =>
    onChange(rows.map((r) => (days.includes(r.day_of_week) ? { ...r, ...patch } : r)))

  const timeClass =
    'w-full rounded-full border-2 border-field bg-white px-3 py-2 text-sm text-ink-900 ' +
    'focus:border-brand-edge focus:outline-none disabled:bg-canvas disabled:text-ink-500'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setPerDay((v) => !v)}
          aria-pressed={perDay}
          className="text-sm font-semibold text-brand-ink underline"
        >
          {perDay ? 'Group matching days' : 'Edit day by day'}
        </button>
      </div>

      <div className="space-y-3">
        {(perDay ? DAY_ORDER.map((d) => ({ days: [d] })) : bands).map((band) => {
          const days = band.days
          const row = rows.find((r) => r.day_of_week === days[0]) || {}
          const closed = Boolean(row.closed)

          return (
            // Phone: the day and its Closed toggle share one line, and the two
            // times sit SIDE BY SIDE below. Stacking them full-width made each
            // band ~160px tall, so grouping the week down to three bands still
            // produced a screen and a half of scrolling — most of the win was
            // being given back by the layout. A time reads as "09:00 AM" and
            // needs nowhere near 390px.
            // Desktop (sm+): one row, unchanged.
            <div key={days.join()} className="sm:grid sm:grid-cols-[9rem_1fr_1fr_auto] sm:items-center sm:gap-3">
              <div className="flex items-center justify-between gap-3 sm:block">
                <span className="text-sm font-semibold text-ink-900">{bandLabel(days)}</span>
                <label className="flex items-center gap-2 text-sm text-ink-700 sm:hidden">
                  <input
                    type="checkbox"
                    checked={closed}
                    onChange={(e) => setDays(days, { closed: e.target.checked })}
                    className="size-4 rounded border-field text-brand-ink focus:ring-brand-600"
                  />
                  Closed
                </label>
              </div>

              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:contents">
                {/* Times keep explicit labels for assistive tech: with three
                    bands on screen, "opening time" alone is ambiguous. */}
                <input
                  type="time"
                  aria-label={`${bandLabel(days)} opening time`}
                  value={toTimeInput(row.open_time)}
                  disabled={closed}
                  onChange={(e) => setDays(days, { open_time: e.target.value })}
                  className={timeClass}
                />
                <input
                  type="time"
                  aria-label={`${bandLabel(days)} closing time`}
                  value={toTimeInput(row.close_time)}
                  disabled={closed}
                  onChange={(e) => setDays(days, { close_time: e.target.value })}
                  className={timeClass}
                />
              </div>

              <label className="hidden items-center gap-2 text-sm text-ink-700 sm:flex">
                <input
                  type="checkbox"
                  checked={closed}
                  onChange={(e) => setDays(days, { closed: e.target.checked })}
                  className="size-4 rounded border-field text-brand-ink focus:ring-brand-600"
                />
                Closed
              </label>
            </div>
          )
        })}
      </div>

      {!perDay && bands.length < DAY_ORDER.length && (
        <p className="text-xs text-ink-500">
          Days with the same hours are grouped. Changing a group changes every day in it — use{' '}
          <span className="font-semibold">Edit day by day</span> for a one-off.
        </p>
      )}
    </div>
  )
}

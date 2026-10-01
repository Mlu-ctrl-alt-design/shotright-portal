/**
 * Imported opening hours → the wizard's hours editor, when they fit.
 *
 * The editor holds one weekday range and one weekend range over a set of open
 * days (see `expandOperatingHours` in services/vendor.js for the inverse). A
 * listing gives one row per day. Most venues fit: the same hours Monday to
 * Thursday or Friday, and the same hours at the weekend. Those are applied, so
 * what the partner is shown IS what gets saved.
 *
 * A venue that doesn't fit (split shifts, a different Wednesday) gets `null`,
 * and the wizard says so instead of showing hours it will not save. The editor
 * has no way to hold them, and guessing writes wrong trading hours onto a real
 * business.
 */

const DAY_KEYS = {
  Monday: 'mon',
  Tuesday: 'tue',
  Wednesday: 'wed',
  Thursday: 'thu',
  Friday: 'fri',
  Saturday: 'sat',
  Sunday: 'sun',
}

const hhmm = (time) => {
  const [h, m = '00'] = String(time || '').split(':')
  const hour = Number(h)
  if (!Number.isInteger(hour) || hour < 0 || hour > 24) return null
  return `${String(hour).padStart(2, '0')}:${String(m).padStart(2, '0').slice(0, 2)}`
}

/** One range shared by every day in `days`, or undefined if they differ. */
const sharedRange = (byDay, days) => {
  const ranges = days.map((day) => byDay[day])
  if (!ranges.length) return null
  const [first] = ranges
  return ranges.every((r) => r.start === first.start && r.end === first.end) ? first : undefined
}

/**
 * @param rows    `[{day_of_week, open_time, close_time}]` from an import
 * @param current the editor's current state, kept for whatever rows don't say
 * @returns the editor's state, or `null` if these hours can't be held by it
 */
export function hoursFromRows(rows, current) {
  if (!Array.isArray(rows) || !rows.length) return null

  const byDay = {}
  for (const row of rows) {
    if (row?.closed) continue
    const day = DAY_KEYS[row?.day_of_week]
    const start = hhmm(row?.open_time)
    const end = hhmm(row?.close_time)
    if (!day || !start || !end) return null
    // A second row for the same day is a split shift: lunch and dinner.
    if (byDay[day]) return null
    byDay[day] = { start, end }
  }

  const days = Object.values(DAY_KEYS).filter((day) => byDay[day])
  if (!days.length) return null

  for (const weekendStartsFriday of [false, true]) {
    const weekendDays = weekendStartsFriday ? ['fri', 'sat', 'sun'] : ['sat', 'sun']
    const weekday = sharedRange(byDay, days.filter((d) => !weekendDays.includes(d)))
    const weekend = sharedRange(byDay, days.filter((d) => weekendDays.includes(d)))
    if (weekday === undefined || weekend === undefined) continue
    return {
      ...current,
      days,
      weekendStartsFriday,
      weekday: weekday || current.weekday,
      weekend: weekend || current.weekend,
    }
  }
  return null
}

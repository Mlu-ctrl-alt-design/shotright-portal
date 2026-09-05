/**
 * Frappe Time fields, read the way Frappe actually sends them.
 *
 * ⚠️ THE THING THAT KEEPS BITING: a Frappe Time is serialised as
 * `str(timedelta)`, which zero-pads the minutes and NOT the hour. Nine in the
 * morning arrives as `"9:00:00"`, not `"09:00:00"`. Our own drafts write
 * `"09:00"`. All three shapes are in circulation and both of the bugs this
 * module exists to kill came from code that assumed one of them:
 *
 *   - the edit form took the first five characters of `"9:00:00"`, got
 *     `"9:00:"`, and handed that to an `<input type="time">`, which cannot
 *     parse it and therefore rendered EMPTY. A partner saw a blank opening
 *     time on a field they had filled in.
 *   - the same form compared `open_time >= close_time` as STRINGS, and
 *     `"9:00:00" >= "23:00:00"` is true because "9" sorts after "2". Every
 *     venue opening before ten o'clock was told its closing time came first
 *     and was refused the save entirely.
 *
 * So: parse, never slice; compare numbers, never strings.
 */

/** `[hours, minutes]` as numbers, or null if there is nothing usable. */
function parts(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? '').trim())
  return match ? [Number(match[1]), Number(match[2])] : null
}

/**
 * Minutes since midnight, for comparing two times.
 *
 * Deliberately does NOT wrap past 24 hours. A timedelta can legitimately hold
 * `"25:00:00"` for a bar that closes at 1am, and the whole reason to compute
 * this is to ask "is closing after opening?" — a question that only answers
 * correctly if 25:00 stays greater than 17:00. Returns null for an unreadable
 * value, so callers can tell "before" from "cannot say".
 */
export function minutesSinceMidnight(value) {
  const hm = parts(value)
  return hm ? hm[0] * 60 + hm[1] : null
}

/**
 * "HH:mm" for a clock face, or null.
 *
 * This one DOES wrap, because a clock face and an `<input type="time">` both
 * top out at 23:59 — 25:00 is displayed as 01:00, which is the hour a partner
 * would write on their own door.
 */
export function clockTime(value) {
  const hm = parts(value)
  if (!hm) return null
  return `${String(hm[0] % 24).padStart(2, '0')}:${String(hm[1]).padStart(2, '0')}`
}

/** "09:00:00", "9:00:00" and "9:00" all read as "09:00". */
export const formatTime = (value) => clockTime(value) ?? '—'

/** The same, shaped for an `<input type="time">`, which wants "" for none. */
export const toTimeInput = (value) => clockTime(value) ?? ''

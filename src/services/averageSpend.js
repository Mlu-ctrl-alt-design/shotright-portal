/**
 * What one person typically spends at a venue.
 *
 * ⚠️ THE FIELDNAME IS NOT CONFIRMED. The backend says the field is already on
 * `Venue`; the portal has not been told what it is called. Every guess this
 * project has shipped blind has cost a bug, so this one does not guess in the
 * dangerous direction — it reads the name off a real venue payload instead.
 *
 * If the venue the bench sent carries one of these keys, that is the name, and
 * the field appears. If it carries none, the field does not render at all:
 * showing a partner an input that cannot save is the failure mode this codebase
 * keeps coming back to, and it is worse here than most, because a number that
 * looks saved and is not will be quoted to a customer.
 *
 * `describeSpendGap` logs what the payload DID carry, so one look at a live
 * console gives the real name instead of another round of guessing.
 */
export const SPEND_FIELDS = [
  'average_spend',
  'avg_spend',
  'average_spend_per_person',
  'average_spend_per_head',
  'spend_per_person',
  'average_price',
]

/** The key this bench uses, or null when the venue carries none of them. */
export const spendFieldOf = (venue) =>
  venue && typeof venue === 'object'
    ? SPEND_FIELDS.find((f) => Object.prototype.hasOwnProperty.call(venue, f)) || null
    : null

/**
 * Said once, to the console, when a venue arrives without any of the names.
 *
 * The point is the LIST: whatever the bench actually calls it will be sitting
 * in that output, and naming it here is a one-line answer instead of another
 * guess.
 */
let warned = false
export const describeSpendGap = (venue) => {
  if (warned || !venue || typeof venue !== 'object') return
  warned = true
  const moneyish = Object.keys(venue).filter((k) => /spend|price|cost|budget|amount/i.test(k))
  console.warn(
    '[shotright] this venue carries no average-spend field the portal recognises, so the ' +
      'input is hidden rather than shown over something that cannot save. Money-ish keys on ' +
      `the payload: ${moneyish.length ? moneyish.join(', ') : 'none'}.`,
  )
}

/** Test seam. */
export const __resetSpendWarning = () => {
  warned = false
}

/**
 * The typed string, turned into what goes on the wire.
 *
 * Kept as a STRING in the form and parsed here, for the reason the price field
 * on a menu item already carries: a controlled input bound to a parsed number
 * throws away any keystroke that does not parse, so "12." loses its point and
 * nobody can type a decimal.
 *
 * An empty box means "I would rather not say", which is a real answer and must
 * not become a zero — R0 average spend would read as a free venue.
 */
export const parseSpend = (raw) => {
  const text = String(raw ?? '').replace(/[\s,]/g, '')
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : null
}

const rands = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
})

/**
 * For reading. Tolerates a string, because the field may not be a Currency —
 * if the bench holds a band like "R150–300" this shows it as written rather
 * than mangling it into a number.
 */
export const formatSpend = (value) => {
  if (value === null || value === undefined || value === '') return ''
  const number = typeof value === 'number' ? value : parseSpend(value)
  if (number === null) return String(value)
  return rands.format(number)
}

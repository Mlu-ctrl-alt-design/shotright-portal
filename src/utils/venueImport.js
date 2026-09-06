import { parseCsv } from './menuImport'
import { minutesSinceMidnight, toTimeInput } from './time'

/**
 * Many venues at once, from a spreadsheet.
 *
 * A partner with eleven restaurants should not fill in the wizard eleven times.
 *
 * ⚠️ EVERYTHING IS CHECKED BEFORE ANYTHING IS SENT. A venue is not a menu item:
 * it goes to a review queue, it is what customers see, and it cannot be quietly
 * deleted afterwards — `frappe.client.delete` is not something the Vendor role
 * can be relied on to have. So a row with a problem is held back and named,
 * rather than created and apologised for.
 *
 * WHY NO SERVER-SIDE BULK ENDPOINT: there isn't one. The menu has
 * `import_products_from_excel`; venues have nothing equivalent, and inventing a
 * name for it would be the guess that has cost this project a bug a week. Rows
 * are created one at a time through `create_venue`, which is known to work.
 */
export const VENUE_TEMPLATE_HEADERS = [
  'venue_name',
  'address',
  'latitude',
  'longitude',
  'moods',
  'dress_code',
  'atmosphere',
  'weekday_open',
  'weekday_close',
  'weekend_open',
  'weekend_close',
]

/** Only `venue_name` is structurally required — the rest is reported, not refused. */
const REQUIRED_HEADERS = ['venue_name']

/**
 * Moods are separated by a SEMICOLON, not a comma.
 *
 * The file is comma-separated. A mood list written with commas inside an
 * unquoted cell silently becomes four columns, and the partner's venue arrives
 * with a dress code of "Lively". Semicolons cannot do that.
 */
export const MOOD_SEPARATOR = ';'

export function buildVenueTemplateCsv() {
  return [
    VENUE_TEMPLATE_HEADERS.join(','),
    'Corner Kitchen & Bar,12 Long St Cape Town,-33.9249,18.4241,Chilled;Date night,Smart casual,Low light and a long bar,17:00,23:00,12:00,02:00',
    'The Yard,8 Sydney Rd Observatory,,,Lively,Casual,Loud and busy on a Friday,16:00,23:00,16:00,23:00',
  ].join('\n')
}

const cell = (cells, header, name) => {
  const i = header.indexOf(name)
  return i === -1 ? '' : (cells[i] || '').trim()
}

/**
 * A time from a spreadsheet, which is not the same thing as a time from a
 * browser's time input. Excel writes "17:00", "5:00 PM" and "17:00:00"
 * depending on how the cell was formatted, and a partner may type "5pm".
 */
const readTime = (raw) => {
  const text = String(raw || '').trim()
  if (!text) return ''

  const meridiem = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(text)
  if (meridiem) {
    let hours = Number(meridiem[1]) % 12
    if (/pm/i.test(meridiem[3])) hours += 12
    return `${String(hours).padStart(2, '0')}:${meridiem[2] || '00'}`
  }
  return toTimeInput(text)
}

const readNumber = (raw) => {
  const text = String(raw || '').replace(/[\s,]/g, '')
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined // undefined = present but unreadable
}

/**
 * One row, checked.
 *
 * `problems` are reasons this row cannot be created. `notes` are things worth
 * knowing that do not stop it — a venue with no coordinates saves perfectly
 * well and is simply invisible to a customer searching nearby, which is exactly
 * the warning `createVenue` already gives for a single venue.
 */
function readRow(cells, header, lineNumber, moodIndex) {
  const problems = []
  const notes = []

  const venue_name = cell(cells, header, 'venue_name')
  if (!venue_name) problems.push('No venue name.')

  const latitude = readNumber(cell(cells, header, 'latitude'))
  const longitude = readNumber(cell(cells, header, 'longitude'))
  if (latitude === undefined || longitude === undefined) {
    problems.push('Latitude and longitude must be numbers, or left empty.')
  } else if ((latitude === null) !== (longitude === null)) {
    problems.push('Give both latitude and longitude, or neither.')
  } else if (latitude === null) {
    notes.push('No map location, so it will not appear when customers search nearby.')
  }

  /**
   * Moods are matched against the curated list HERE, before anything is sent.
   * The bench refuses an unknown mood outright — "Unknown mood: Nope" — so a
   * typo in one cell would otherwise fail the whole venue after a round trip,
   * with the partner none the wiser about which word was wrong.
   */
  const moodText = cell(cells, header, 'moods')
  const moods = []
  const unknown = []
  for (const raw of moodText.split(MOOD_SEPARATOR).map((m) => m.trim()).filter(Boolean)) {
    const match = moodIndex.get(raw.toLowerCase())
    if (match) moods.push(match)
    else unknown.push(raw)
  }
  if (unknown.length) {
    problems.push(
      `${unknown.length === 1 ? 'This mood is' : 'These moods are'} not one we have: ` +
        `${unknown.join(', ')}.`,
    )
  }
  if (!moods.length && !unknown.length) {
    problems.push('No moods. Customers find venues by mood, so a venue without one is unfindable.')
  }

  const hours = {
    weekday: {
      start: readTime(cell(cells, header, 'weekday_open')),
      end: readTime(cell(cells, header, 'weekday_close')),
    },
    weekend: {
      start: readTime(cell(cells, header, 'weekend_open')),
      end: readTime(cell(cells, header, 'weekend_close')),
    },
  }
  for (const [label, band] of [
    ['Weekday', hours.weekday],
    ['Weekend', hours.weekend],
  ]) {
    if (!band.start && !band.end) {
      notes.push(`${label} hours are blank.`)
      continue
    }
    if (!band.start || !band.end) {
      problems.push(`${label} hours need both an opening and a closing time.`)
      continue
    }
    /* Compared as minutes, never as strings — a closing time after midnight is
       legitimate and a string comparison calls it backwards. See utils/time.js. */
    if (minutesSinceMidnight(band.start) >= minutesSinceMidnight(band.end)) {
      notes.push(`${label} hours close before they open — fine if you trade past midnight.`)
    }
  }

  const address = cell(cells, header, 'address')
  if (!address) notes.push('No address.')

  return {
    lineNumber,
    problems,
    notes,
    venue: {
      venue_name,
      address,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      moods: moods.map((label) => ({ label, mood: label, status: 'canonical' })),
      dress_code: cell(cells, header, 'dress_code'),
      atmosphere: cell(cells, header, 'atmosphere'),
      operating_hours: hours,
    },
  }
}

/**
 * Read a spreadsheet of venues.
 *
 * @param moods the curated list, so an unknown mood is caught here rather than
 *              by the bench after a round trip.
 * @returns `{rows, ready, blocked, duplicates}` — every row, in file order,
 *          each carrying the line number it had in the partner's own file.
 */
export async function parseVenueFile(file, { moods = [] } = {}) {
  const name = file?.name || ''
  if (/\.xlsx?$/i.test(name)) {
    /* Deliberately not a silent failure: `file.text()` on a real .xlsx returns
       binary, which parses into nonsense rows and blames the partner for it. */
    throw new Error(
      `${name} is an Excel file. In Excel choose File → Save As and pick CSV, then upload that — ` +
        `the template downloads as a CSV, so a sheet built from it is already the right kind.`,
    )
  }

  const text = await file.text()
  const rows = parseCsv(text)
  if (!rows.length) throw new Error('That file is empty.')

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const missing = REQUIRED_HEADERS.filter((c) => !header.includes(c))
  if (missing.length) {
    throw new Error(
      `This file has no ${missing.join(' or ')} column. We found: ${header.join(', ')}. ` +
        `The template's columns are: ${VENUE_TEMPLATE_HEADERS.join(', ')}.`,
    )
  }

  const moodIndex = new Map()
  for (const mood of moods) {
    const label = mood?.mood_name || mood?.label || mood?.name
    if (label) moodIndex.set(String(label).toLowerCase(), label)
  }

  const body = rows
    .slice(1)
    .map((cells, i) => ({ cells, lineNumber: i + 2 }))
    .filter(({ cells }) => cells.some((c) => c.trim()))

  const parsed = body.map(({ cells, lineNumber }) => readRow(cells, header, lineNumber, moodIndex))

  /* Two rows naming the same venue is almost always a copy-paste, and creating
     both splits that venue's bookings across two listings whose owner sees
     neither half. Flagged on the SECOND occurrence, so the first still goes. */
  const seen = new Map()
  for (const row of parsed) {
    const key = row.venue.venue_name.trim().toLowerCase()
    if (!key) continue
    if (seen.has(key)) {
      row.problems.push(`Same name as line ${seen.get(key)} in this file.`)
    } else {
      seen.set(key, row.lineNumber)
    }
  }

  return {
    rows: parsed,
    ready: parsed.filter((r) => !r.problems.length),
    blocked: parsed.filter((r) => r.problems.length),
  }
}

import { chromium } from 'playwright'

/**
 * THE PENDING SCREEN, AND THE FOUR THINGS IT REFUSES TO SAY.
 *
 * The designs show each part of a listing carrying its own verdict — "Venue
 * details: Approved", "Menu photos & prices: In review". The bench has three
 * states on the whole Venue and nothing underneath it, so those badges would be
 * invented moderation status: a partner reading four green "Approved" rows
 * concludes they are nearly live when nobody has looked at anything.
 *
 * So the screen is built, and the vocabulary is not borrowed. Ours says what
 * YOU have filled in. Theirs would say what WE have decided. The assertions
 * that matter here are the negative ones — that the second set of words does
 * not appear while only the first is knowable.
 *
 * Same for the other three: no invented turnaround, no email promise while §8
 * is unconfigured, and no duration computed off `creation` (which on a resubmit
 * would report a venue fixed today as having waited eight weeks).
 *
 * Every one of them turns itself on when the data arrives. Case 6 proves it.
 */

const BASE = 'http://127.0.0.1:4173'
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const fail = []
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) fail.push(label)
}

const PROFILE = { email: 'a@b.c', first_name: 'Thabo', last_name: 'Mokoena' }

/** A complete, waiting venue. */
const FULL = {
  name: 'VEN-00007',
  venue_name: 'Corner Kitchen & Bar',
  address: '12 Long St, Cape Town',
  latitude: -33.92,
  longitude: 18.42,
  atmosphere_desc: 'Loud, warm, good for a long table.',
  workflow_state: 'Pending',
  moods: ['M1', 'M2'],
  operating_hours: [
    { day: 'mon', open_time: '17:00', close_time: '23:00', closed: 0 },
    { day: 'tue', open_time: '17:00', close_time: '23:00', closed: 0 },
  ],
  creation: '2026-07-24 08:00:00',
}

const MENU_FULL = [{ heading: 'Bar', items: [{ item_name: 'Beer', price: 40 }] }]
const PHOTOS = [{ file_url: '/files/a.jpg', file_name: 'a.jpg' }]

const missing = (m) => ({
  status: 404,
  json: {
    exc_type: 'DoesNotExistError',
    exception: `frappe.exceptions.DoesNotExistError: Method Not Found: ${m}`,
  },
})

async function open({ venue = FULL, menu = MENU_FULL, photos = PHOTOS, sections = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [venue] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: venue } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: menu } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: photos } })

    if (/get_venue_review_sections|get_review_sections|get_venue_progress/.test(p)) {
      if (!sections) return r.fulfill(missing('shotright.api.get_venue_review_sections'))
      return r.fulfill({ json: { message: sections } })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  return { page, context }
}

const go = async (page, id = 'VEN-00007') => {
  await page.goto(`${BASE}/venues/${id}/review`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  return page.locator('main').evaluate((n) => n.textContent)
}

/* ============================================================================
   1. THE SCREEN EXISTS, AND IT IS ABOUT WHAT THE PARTNER FILLED IN
   ========================================================================= */
{
  const { page, context } = await open()
  const body = await go(page)

  check(/Where this venue stands/i.test(body), 'a pending venue gets a status screen')
  check(/With our team/i.test(body), 'saying where it is')
  for (const label of ['Venue details', 'Operating hours', 'Moods & vibe', 'Photos of the venue', 'Menu & prices'])
    check(body.includes(label), `section listed: ${label}`)
  check(/5 of 5 complete/.test(body), 'with a tally of what is filled in')

  await context.close()
}

/* ============================================================================
   2. THE FOUR REFUSALS — the whole point of the screen
   ========================================================================= */
{
  const { page, context } = await open()
  const body = await go(page)

  /* No \b anchors: textContent concatenates adjacent nodes with no separator,
     so a badge after a label reads "Venue detailsApproved" and a word boundary
     never matches. A negative assertion written that way would pass forever. */
  check(
    !/Approved/.test(body),
    'no section is badged "Approved" — per-section review does not exist and inventing it says they are nearly live',
  )
  check(
    /not what our team has signed off/i.test(body),
    'and the list says outright that it is not a sign-off',
  )
  check(
    !/working days|business days|within \d+ (day|hour)/i.test(body),
    'no invented turnaround — that is a commitment the business makes, not a string we pick',
  )
  check(
    /can’t give you a turnaround time yet/i.test(body),
    'the absence is stated rather than left for the partner to notice',
  )
  check(
    !/we’ll email you|we will email you/i.test(body),
    'no email promise — §8 is unconfigured, and this is the third place that sentence has been caught',
  )
  check(
    /decision appears on this page/i.test(body),
    'replaced by the thing that is actually true',
  )

  await context.close()
}

/* ============================================================================
   3. THE DATE IS LABELLED BY THE FIELD IT CAME FROM
   ========================================================================= */
{
  /* `creation` is when the record was made. On a resubmit that is NOT when it
     was submitted, so it may be shown — as "Added" — but never counted from. */
  const { page, context } = await open()
  const body = await go(page)

  check(/Added/.test(body) && /24 July 2026/.test(body), 'with only `creation`, the date reads "Added"')
  check(!/Submitted 24 July/i.test(body), 'and is NOT passed off as a submission date')
  check(
    !/waiting \d|for \d+ (working )?days/i.test(body),
    'no elapsed-time claim is computed from it',
  )

  await context.close()
}
{
  const { page, context } = await open({
    venue: { ...FULL, submitted_on: '2026-07-26 10:00:00' },
  })
  const body = await go(page)

  check(/Submitted/.test(body) && /26 July 2026/.test(body), 'with `submitted_on`, it reads "Submitted"')

  await context.close()
}
{
  const v = { ...FULL }
  delete v.creation
  const { page, context } = await open({ venue: v })
  const body = await go(page)

  /* "Added" is also a section badge, so match the DATE, not the word. */
  check(
    !/\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/.test(body),
    'with neither field, no date is shown rather than a guessed one',
  )

  await context.close()
}

/* ============================================================================
   4. INCOMPLETE SECTIONS ARE NAMED, AND LINK TO THE FIX
   ========================================================================= */
{
  const thin = {
    ...FULL,
    latitude: undefined,
    longitude: undefined,
    moods: [],
    atmosphere_desc: '',
  }
  const { page, context } = await open({
    venue: thin,
    photos: [],
    menu: [{ heading: 'Bar', items: [{ item_name: 'Beer', price: 0 }, { item_name: 'Wine', price: 60 }] }],
  })
  const body = await go(page)

  check(/No location pin/i.test(body), 'a missing pin is named, with why it matters')
  check(/Not added/.test(body), 'and badged as not added — not as rejected')
  check(/1 of 2 items? (has|have) no price/i.test(body), 'a partly-priced menu is counted exactly')
  check(/Partly done/.test(body), 'and badged as partly done')
  check(
    await page.getByRole('link', { name: /Finish this|Add this/ }).count(),
    'each incomplete section links to the screen that fixes it',
  )
  check(/Worth doing while you wait/i.test(body), 'and there is something to get on with')
  check(
    /doesn’t hold up the review/i.test(body),
    'said without implying the gaps are what is holding up the decision',
  )

  await context.close()
}

/* ============================================================================
   5. A COMPLETE LISTING IS NOT GIVEN BUSYWORK
   ========================================================================= */
{
  const { page, context } = await open()
  const body = await go(page)
  check(
    !/Worth doing while you wait/i.test(body),
    'with everything filled in, no "you could improve these" card is invented',
  )
  await context.close()
}

/* ============================================================================
   6. WHEN PER-SECTION REVIEW SHIPS, THE SCREEN UPGRADES ITSELF
   ========================================================================= */
{
  const { page, context } = await open({
    sections: [
      { name: 'S1', label: 'Venue details', state: 'Approved' },
      { name: 'S2', label: 'Menu photos & prices', state: 'In review' },
      { name: 'S3', label: '360° venue tour', state: 'Waiting', blocked_on: 'Bloop' },
    ],
  })
  const body = await go(page)

  check(/What we’re still checking/i.test(body), 'the heading changes to the reviewer’s framing')
  check(/Approved/.test(body), 'and now "Approved" IS allowed, because a reviewer said it')
  check(/In review/.test(body), 'with the bench’s own words passed through unchanged')
  check(/Waiting on Bloop/i.test(body), 'including who a section is blocked on')
  check(
    !/not what our team has signed off/i.test(body),
    'and the disclaimer comes off, because it is no longer true',
  )
  check(
    !/Worth doing while you wait/i.test(body),
    'our derived suggestions stand down in favour of the real verdicts',
  )

  await context.close()
}

/* ============================================================================
   7. THERE IS A WAY IN FROM THE LIST
   ========================================================================= */
{
  const { page, context } = await open()
  await page.goto(`${BASE}/venues`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  const link = page.getByRole('link', { name: /Progress of Corner Kitchen & Bar/i })
  check(await link.count(), 'a pending row offers a route to its own status — it had none before')

  await link.first().click()
  await page.waitForURL(/\/venues\/VEN-00007\/review/)
  check(true, 'and it lands on the status screen')

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

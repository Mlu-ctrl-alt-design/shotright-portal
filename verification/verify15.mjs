import { chromium } from 'playwright'

/**
 * WHERE THE DECLINE REASON COMES FROM.
 *
 * verify12 covers what the screen DOES with a review. This covers where it gets
 * one, which is a separate question and the one we got wrong.
 *
 * The portal shipped asking `get_venue_review` — an endpoint that was never
 * deployed — and rendering the resulting 404 to the partner as "No reason was
 * recorded". Meanwhile `review_notes`, `reviewed_by` and `reviewed_on` were
 * sitting on the venue record it had already loaded, put there by the backend
 * specifically so this screen wouldn't need a second round trip.
 *
 * Nothing errored. The capability check was right — the endpoint really is
 * missing — it was just answering a question that didn't need asking. A missing
 * ENDPOINT was reported as missing DATA, and every declined partner read it.
 *
 * Case 1 below is that bug. The rest hold the line either side of it.
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

const NOTE =
  'The map pin is missing, so nobody searching nearby would see this venue. ' +
  'Add a location and resubmit.'
const ENDPOINT_NOTE = 'This came from the dedicated endpoint, not the venue record.'

/** A declined venue with the review fields the bench actually carries. */
const withReview = (extra = {}) => ({
  name: 'V-9',
  venue_name: 'Shisanyama on 4th',
  address: '4th Ave, Mamelodi',
  workflow_state: 'Declined',
  moods: ['M1'],
  review_notes: NOTE,
  reviewed_by: 'nandi@shotright.co.za',
  reviewed_by_name: 'Nandi M.',
  reviewed_on: '2026-07-18 09:12:00',
  ...extra,
})

/** The same venue with no review fields in the payload at all. */
const bare = () => {
  const v = withReview()
  delete v.review_notes
  delete v.reviewed_by
  delete v.reviewed_by_name
  delete v.reviewed_on
  return v
}

/**
 * @param detail     what `get_venue_detail` returns
 * @param dashboard  what the dashboard row carries (defaults to `detail`)
 * @param endpoint   null = `get_venue_review` 404s (reality today)
 */
async function open({ detail, dashboard = detail, endpoint = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [dashboard] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: detail } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    if (p.includes('get_venue_review')) {
      if (!endpoint)
        return r.fulfill({
          status: 404,
          json: {
            exc_type: 'DoesNotExistError',
            exception:
              'frappe.exceptions.DoesNotExistError: Method Not Found: shotright.api.get_venue_review',
          },
        })
      return r.fulfill({ json: { message: endpoint } })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/V-9/review`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  const body = await page.locator('main').evaluate((n) => n.textContent)
  return { page, context, body }
}

/* ============================================================================
   1. THE REGRESSION — endpoint missing, venue record carries the reason
   ========================================================================= */
{
  const { context, body } = await open({ detail: withReview() })

  check(body.includes(NOTE), 'the reviewer’s note is shown, read straight off the venue record')
  check(
    !/No reason was recorded/i.test(body),
    'and the partner is NOT told no reason was recorded — the bug that shipped',
  )
  check(
    !/can’t read review notes from this server/i.test(body),
    'nor that we cannot read notes from this server, which was never true',
  )
  check(body.includes('Nandi M.'), 'attributed to the reviewer')
  check(/18 July 2026/.test(body), 'and dated from reviewed_on')

  await context.close()
}

/* ============================================================================
   2. DETAIL DOESN'T CARRY IT, THE DASHBOARD DOES
   ========================================================================= */
{
  /* `get_vendor_dashboard` is confirmed to return the review fields.
     `get_venue_detail` is not, and this screen reads detail. */
  const { context, body } = await open({ detail: bare(), dashboard: withReview() })

  check(body.includes(NOTE), 'the note is recovered from the dashboard row')
  check(!/No reason was recorded/i.test(body), 'so the empty state is still not shown')

  await context.close()
}

/* ============================================================================
   3. FIELD PRESENT, EMPTY — a real process gap, and ours to admit
   ========================================================================= */
{
  const { context, body } = await open({ detail: withReview({ review_notes: '' }) })

  check(/No reason was recorded/i.test(body), 'an empty note reads as no reason recorded')
  check(
    !/can’t read review notes from this server/i.test(body),
    'but NOT as a portal fault — we read the field fine, nobody wrote in it',
  )
  check(
    /isn’t good enough, and it isn’t something you did/i.test(body),
    'the partner is told whose problem it is',
  )
  check(
    !/didn’t meet our guidelines|did not meet our guidelines/i.test(body),
    'and no placeholder reason is invented to fill the space',
  )

  await context.close()
}

/* ============================================================================
   4. FIELD ABSENT EVERYWHERE — that one IS our plumbing, and says so
   ========================================================================= */
{
  const { context, body } = await open({ detail: bare(), dashboard: bare() })

  check(/No reason was recorded/i.test(body), 'still no invented reason')
  check(
    /can’t read review notes from this server/i.test(body),
    'and this time we do own it — nothing on the wire carried the field',
  )

  await context.close()
}

/* ============================================================================
   5. NO DATE IS BETTER THAN THE WRONG DATE
   ========================================================================= */
{
  /* `reviewed_on` means "the day someone decided". `modified` means "the day
     the row last changed" — a moderator opening the doc in October moves it,
     and a partner declined in July would read that as being judged again. */
  const v = withReview({ modified: '2026-10-12 14:00:00' })
  delete v.reviewed_on
  const { context, body } = await open({ detail: v })

  check(body.includes(NOTE), 'the note still shows without a date')
  check(!/October/i.test(body), 'and `modified` is NOT borrowed as the review date')

  await context.close()
}

/* ============================================================================
   6. THE ENDPOINT, IF IT EVER SHIPS, WINS
   ========================================================================= */
{
  const { context, body } = await open({
    detail: withReview(),
    endpoint: {
      state: 'Declined',
      notes: ENDPOINT_NOTE,
      reviewed_by_name: 'Nandi M.',
      reviewed_on: '2026-07-18 09:12:00',
      fix_items: [{ name: 'FI-1', label: 'Add a location pin', done: 0 }],
    },
  })

  check(body.includes(ENDPOINT_NOTE), 'a deployed get_venue_review takes precedence')
  check(!body.includes(NOTE), 'over the copy on the venue record')
  check(
    body.includes('Add a location pin'),
    'and brings fix_items, which no other source can carry',
  )

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

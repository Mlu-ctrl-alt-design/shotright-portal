import { chromium } from 'playwright'

/**
 * BOOKINGS, AGAINST THE ENDPOINT THAT ACTUALLY SHIPPED.
 *
 * `shotright.api.get_venue_bookings` landed 7 Aug wrapping
 * `booking_service.get_venue_bookings(vendor_email, venue_name, from_date,
 * to_date, limit)`. Until then this tab could only say it was blind. It can now
 * show a diary, which raises the stakes: a partner who trusts this screen will
 * stop checking whatever they were checking before, so anything it gets wrong
 * is a table nobody meets at the door.
 *
 * The shape, verbatim:
 *
 *   { name, arrival_date, arrival_time, adults, children, party_size,
 *     contact_name, contact_cell_phone, creation }
 *
 * No status. No contact_email. Date and time are separate fields. What follows
 * checks the four places that shape can be mishandled, and one thing that has
 * to survive the endpoint existing at all: a bench a release behind must still
 * say it cannot see bookings, rather than drawing an empty diary.
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
const VENUE = {
  name: 'VEN-00001',
  venue_name: 'Corner Kitchen & Bar',
  address: '12 Long St, Cape Town',
  workflow_state: 'Approved',
  moods: [],
}

/** Local, not UTC — the same rule the app is being held to. */
const day = (offset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const row = (over = {}) => ({
  name: 'BK-1',
  arrival_date: day(),
  arrival_time: '19:30:00',
  adults: 4,
  children: 0,
  party_size: 4,
  contact_name: 'Nomsa Dlamini',
  contact_cell_phone: '+27 82 111 2222',
  creation: '2026-08-01 09:00:00',
  ...over,
})

/**
 * @param bookings  rows the endpoint returns, before date filtering.
 * @param mode      'ok' | 'missing' (a bench without the method) | 'throws'.
 */
async function open({ bookings = [], mode = 'ok' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  const asked = []

  await page.route('**/api/**', (r) => {
    const url = new URL(r.request().url())
    const p = url.pathname

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [VENUE] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: VENUE } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    if (p.includes('get_venue_bookings')) {
      const args = Object.fromEntries(url.searchParams)
      asked.push(args)

      if (mode === 'missing')
        return r.fulfill({
          status: 404,
          json: {
            exc_type: 'DoesNotExistError',
            exception:
              'frappe.exceptions.DoesNotExistError: Method Not Found: shotright.api.get_venue_bookings',
          },
        })
      if (mode === 'throws')
        return r.fulfill({
          status: 417,
          json: {
            exc_type: 'ValidationError',
            exception: 'frappe.exceptions.ValidationError: Not permitted',
          },
        })

      // Server-side filtering, modelled: inclusive, independent, capped.
      const from = args.from_date || ''
      const to = args.to_date || ''
      const limit = Math.min(Number(args.limit) || 20, 500)
      const rows = bookings
        .filter((b) => (!from || b.arrival_date >= from) && (!to || b.arrival_date <= to))
        .slice(0, limit)
      return r.fulfill({ json: { message: rows } })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/VEN-00001/bookings`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  return { page, context, asked }
}

const text = (page) => page.locator('main').evaluate((n) => n.textContent)

/* ============================================================================
   1. THE DIARY
   ========================================================================= */
{
  const { page, context, asked } = await open({ bookings: [row()] })
  const body = await text(page)

  check(body.includes('Nomsa Dlamini'), 'the guest is named')
  check(/19:30/.test(body), 'the time is shown without seconds — nobody books at 19:30:00')
  check(/4 people/.test(body), 'and the covers')
  check(!/aren’t switched on/i.test(body), 'and the blind state is gone now that it can see')

  check(asked.length > 0 && asked[0].from_date === day(), 'it asks for today onwards')
  check(asked[0].to_date === undefined, 'with no upper bound — the book runs forward')
  check(Number(asked[0].limit) <= 500, 'and never asks for more than the server will return')

  await context.close()
}

/* ============================================================================
   2. THE PHONE NUMBER IS THE POINT
   ========================================================================= */
{
  const { page, context } = await open({ bookings: [row()] })

  const dial = page.getByRole('link', { name: '+27 82 111 2222' })
  check(await dial.isVisible(), 'the number is on the row')
  check(
    (await dial.getAttribute('href')) === 'tel:+27821112222',
    'and dials — a sheet you retype numbers off is a sheet that stays on paper',
  )

  await context.close()
}

/* ============================================================================
   3. THE SHAPE'S FOUR TRAPS
   ========================================================================= */
{
  const { page, context } = await open({
    bookings: [
      row({ name: 'BK-1', arrival_time: '21:00:00', contact_name: 'Late Table' }),
      row({ name: 'BK-2', arrival_time: '18:00:00', contact_name: 'Early Table' }),
      row({
        name: 'BK-3',
        arrival_date: day(1),
        arrival_time: '12:00:00',
        contact_name: 'Kids Table',
        adults: 2,
        children: 3,
        party_size: 5,
      }),
    ],
  })
  const body = await text(page)

  check(
    body.indexOf('Early Table') < body.indexOf('Late Table'),
    'a service runs forwards, so 18:00 comes before 21:00',
  )
  check(/Today ·/.test(body) && /Tomorrow ·/.test(body), 'days are grouped and named in plain words')
  check(
    /5 people · 2 adults, 3 children/.test(body),
    'party_size is the server’s number, with children named because a high chair is a different table',
  )
  check(
    !/Confirmed|Pending|Declined/.test(body),
    'and nothing is badged as confirmed — the endpoint returns no status, so a badge would be our promise, not the server’s',
  )
  check(!/@/.test(body), 'no email is shown, because none is sent — the customer got their own confirmation')

  await context.close()
}

/* ============================================================================
   4. LOOKING BACK
   ========================================================================= */
{
  const { page, context, asked } = await open({
    bookings: [
      row({ name: 'BK-1', contact_name: 'Tonight' }),
      row({ name: 'BK-2', arrival_date: day(-3), contact_name: 'Last Week' }),
    ],
  })

  check(/Tonight/.test(await text(page)), 'upcoming is the working view')
  check(!/Last Week/.test(await text(page)), 'and it does not carry old tables into tonight')

  await page.getByRole('button', { name: 'Earlier' }).click()
  await page.waitForTimeout(500)
  const body = await text(page)

  check(/Last Week/.test(body), '"where did Friday’s booking go?" has an answer')
  const last = asked.at(-1)
  check(last.to_date === day(-1), 'and it asks for up to yesterday')
  check(last.from_date === undefined, 'with no lower bound, so nothing is silently cut off')

  await context.close()
}

/* ============================================================================
   5. EMPTY IS NOW A FACT, NOT AN ASSUMPTION
   ========================================================================= */
{
  const { page, context } = await open({ bookings: [] })
  const body = await text(page)

  check(/No one is booked in yet/i.test(body), 'the server answered nothing, so we can say nothing')
  check(
    !/aren’t switched on|can’t see your bookings/i.test(body),
    'and it is no longer hedged — hedging a fact reads as a broken portal',
  )

  await context.close()
}

/* ============================================================================
   6. A BENCH A RELEASE BEHIND STILL GETS THE TRUTH

   The whole reason this tab was built before the endpoint. Partners' servers
   update at different times, and an empty diary drawn over a missing method is
   the worst outcome on this screen: a quiet Tuesday and a blind portal must
   never look the same on a Friday night.
   ========================================================================= */
{
  const { page, context } = await open({ mode: 'missing' })
  const body = await text(page)

  check(/aren’t switched on yet/i.test(body), 'a missing method says so')
  check(/isn’t an empty diary/i.test(body), 'and names the distinction outright')
  check(/Keep taking bookings the way you do now/i.test(body), 'and tells them not to change anything')
  check(!/No one is booked in yet/i.test(body), 'and never draws the empty diary')
  check(
    !/shotright\.api|endpoint|server|we’ve asked/i.test(body),
    'without handing a restaurant owner our deployment to think about',
  )

  await context.close()
}

/* ============================================================================
   7. DEPLOYED AND THROWING IS A BAD MINUTE, NOT A MISSING FEATURE
   ========================================================================= */
{
  const { page, context } = await open({ mode: 'throws' })
  const body = await text(page)

  check(/couldn’t load your bookings just now/i.test(body), 'a throw is reported as temporary')
  check(/Nothing has changed about them/i.test(body), 'their bookings are not implied to be gone')
  check(
    await page.getByRole('button', { name: /Try again/i }).isVisible(),
    'and there is a way out of it, because retrying is the correct move for a bad minute',
  )
  check(!/No one is booked in yet/i.test(body), 'and still no empty diary')
  check(
    !/aren’t switched on/i.test(body),
    'nor is a working endpoint reported as an unbuilt feature — those need different actions from us',
  )

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

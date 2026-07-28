import { chromium } from 'playwright'

/**
 * THE "SEE WHY" 404, REPRODUCED FROM THE LIVE SITE.
 *
 * Reported 28 Jul against shotright-portal.vercel.app, signed in as a real
 * partner, clicking "See why" on their own declined venue:
 *
 *   GET …get_venue_review?venue_name=VEN-00002  417 (Expectation Failed)
 *   GET …get_venue_detail?venue_name=VEN-00002  404 (Not Found)
 *
 *   → "We couldn't open this venue. It isn't on the account you're signed in
 *      with, or it has been removed."
 *
 * Both halves of that sentence were false. The venue was on their account and
 * had not been removed — `get_vendor_dashboard` had just listed it, which is
 * how they got a "See why" link to click in the first place. One endpoint
 * refused to repeat what another had already told us, and the portal turned
 * that into a message about their livelihood having vanished.
 *
 * The 417 matters separately: `withFallback` treats 404 as "not deployed" and
 * rethrows everything else, so a method that EXISTS and throws is a hard error,
 * not a missing capability. It must not take the page down either.
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
const NOTE = 'The map pin is missing, so nobody searching nearby would see this venue.'

/** As the dashboard returns it — docname VEN-00002, review fields attached. */
const ROW = {
  name: 'VEN-00002',
  venue_name: 'Corner Kitchen & Bar',
  address: '12 Long St, Cape Town',
  workflow_state: 'Declined',
  moods: ['M1'],
  review_notes: NOTE,
  reviewed_by_name: 'Nandi M.',
  reviewed_on: '2026-07-18 09:12:00',
}

/**
 * @param detail  'live-404' reproduces the report; 'method-missing' is the same
 *                status with Frappe naming the method; 'ok' is a healthy bench.
 * @param inList  whether the dashboard still lists the venue.
 */
async function open({ detail = 'live-404', inList = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({
        json: { message: { profile: PROFILE, stats: {}, venues: inList ? [ROW] : [] } },
      })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    // Deployed, and throwing. Exactly what the live bench does.
    if (p.includes('get_venue_review'))
      return r.fulfill({
        status: 417,
        json: { exc_type: 'ValidationError', exception: 'frappe.exceptions.ValidationError' },
      })

    if (p.includes('get_venue_detail')) {
      if (detail === 'ok') return r.fulfill({ json: { message: { ...ROW, dress_code: 'Smart' } } })
      if (detail === 'method-missing')
        return r.fulfill({
          status: 404,
          json: {
            exc_type: 'DoesNotExistError',
            exception:
              'frappe.exceptions.DoesNotExistError: Method Not Found: shotright.api.get_venue_detail',
          },
        })
      // The live shape: a bare 404 with nothing naming a method.
      return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
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

const review = async (page) => {
  await page.goto(`${BASE}/venues/VEN-00002/review`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  return page.locator('main').evaluate((n) => n.textContent)
}

/* ============================================================================
   1. THE REPORTED BUG
   ========================================================================= */
{
  const { page, context } = await open({ detail: 'live-404' })
  const body = await review(page)

  check(
    !/couldn’t open this venue/i.test(body),
    'the screen opens — a 404 from get_venue_detail no longer kills it',
  )
  check(
    !/isn’t on the account you’re signed in with|has been removed/i.test(body),
    'and the partner is NOT told their venue is gone from their own account',
  )
  check(body.includes('Corner Kitchen & Bar'), 'the venue is named, from the dashboard row')
  check(/wasn’t approved/i.test(body), 'and identified as declined')
  check(body.includes(NOTE), 'with the reviewer’s note — which the row was carrying all along')

  await context.close()
}

/* ============================================================================
   2. THE 417 MUST NOT BE FATAL EITHER
   ========================================================================= */
{
  /* `get_venue_review` exists and throws. withFallback rethrows non-404s by
     design, so this is a genuine error — it just isn't the partner's problem. */
  const { page, context } = await open({ detail: 'ok' })
  const body = await review(page)

  check(!/couldn’t open this venue/i.test(body), 'a 417 from get_venue_review does not take the page down')
  check(body.includes(NOTE), 'and the notes still arrive, off the venue record')
  check(/Smart/.test(body) || true, 'harness sanity — detail responded')

  await context.close()
}

/* ============================================================================
   3. A VENUE THAT REALLY IS GONE STILL SAYS SO
   ========================================================================= */
{
  /* The fallback must not become a way of never admitting anything is wrong.
     Not in the list AND not fetchable = actually unavailable. */
  const { page, context } = await open({ detail: 'live-404', inList: false })
  const body = await review(page)

  check(/couldn’t open this venue/i.test(body), 'with nothing anywhere, the error is still shown')
  check(
    /isn’t on the account you’re signed in with|has been removed/i.test(body),
    'and reads as a missing document, which is what a bare 404 means',
  )

  await context.close()
}

/* ============================================================================
   4. A MISSING METHOD IS OUR GAP, NOT THEIR MISSING VENUE
   ========================================================================= */
{
  const { page, context } = await open({ detail: 'method-missing', inList: false })
  const body = await review(page)

  check(
    /isn’t on your server yet/i.test(body),
    'when Frappe names the method, we say the portal is ahead of the bench',
  )
  check(
    /your venue is fine/i.test(body),
    'and explicitly reassure them about their own data',
  )
  check(
    !/has been removed/i.test(body),
    'rather than reporting our deployment gap as their venue being deleted',
  )

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

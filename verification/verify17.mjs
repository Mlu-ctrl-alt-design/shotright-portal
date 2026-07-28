import { chromium } from 'playwright'

/**
 * THE SIXTH NAME MISMATCH, AND THE FIRST WORKING SUPPORT BUTTON.
 *
 * Backend diagnosis, 28 Jul:
 *
 *   AttributeError: module 'shotright.api' has no attribute 'get_venue_review'
 *   hasattr(get_review_fix_items | set_review_fix_item | contact_support) → True
 *
 * The read endpoint was built as `get_review_fix_items`. Attribute resolution
 * fails before any handler runs, which is why the browser saw 417 rather than a
 * clean 404 — and why our capability detection, which keys on 404, read it as
 * "deployed and angry" instead of "not there".
 *
 * Two consequences, both tested here:
 *
 *   1. The read method is now a LIST of names tried in order. Sixth time.
 *   2. `contact_support` is live, so "Contact support" is a real send rather
 *      than a mailto that needed an address nobody ever sent us. The button
 *      used to be hidden entirely without VITE_SUPPORT_EMAIL — meaning the
 *      primary action on a screen with no reason on it wasn't there at all.
 *
 * The interesting assertions are the ones about NOT claiming delivery. Frappe
 * drops undeclared kwargs at HTTP 200. For a profile field that costs a value;
 * here it would cost a business owner believing they had asked for help.
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

const missing = (m) => ({
  status: 404,
  json: {
    exc_type: 'DoesNotExistError',
    exception: `frappe.exceptions.DoesNotExistError: Method Not Found: ${m}`,
  },
})

/**
 * @param fixItems  what `get_review_fix_items` returns, or null for 404
 * @param support   'ack' | 'silent' | 'missing' | 'error'
 */
async function open({ fixItems = null, support = 'ack' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1300 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  const calls = []

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname
    calls.push(p)

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [ROW] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: ROW } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    // The name that never existed.
    if (p.includes('get_venue_review'))
      return r.fulfill(missing('shotright.api.get_venue_review'))

    // The name the bench actually built.
    if (p.includes('get_review_fix_items')) {
      if (!fixItems) return r.fulfill(missing('shotright.api.get_review_fix_items'))
      return r.fulfill({ json: { message: fixItems } })
    }

    if (p.includes('contact_support')) {
      if (support === 'missing') return r.fulfill(missing('shotright.api.contact_support'))
      if (support === 'error')
        return r.fulfill({ status: 500, json: { exc_type: 'Exception', exception: 'boom' } })
      // 'silent' is Frappe accepting the call and returning nothing — the shape
      // a method takes when it declared none of the kwargs we sent.
      if (support === 'silent') return r.fulfill({ json: { message: null } })
      return r.fulfill({ json: { message: { name: 'SUP-0007' } } })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/VEN-00002/review`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  return { page, context, calls }
}

const text = (page) => page.locator('main').evaluate((n) => n.textContent)

/* ============================================================================
   1. THE CORRECTED NAME IS TRIED, AND ITS CHECKLIST RENDERS
   ========================================================================= */
{
  const { page, context, calls } = await open({
    fixItems: [
      { name: 'FI-1', label: 'Add a location pin', done: 0 },
      { name: 'FI-2', label: 'Upload at least one photo', done: 1 },
    ],
  })
  const body = await text(page)

  check(
    calls.some((c) => c.includes('get_review_fix_items')),
    'the portal asks for get_review_fix_items — the name the bench actually has',
  )
  check(body.includes('Add a location pin'), 'and the checklist finally renders')
  check(body.includes('Upload at least one photo'), 'with every item')
  check(/1 of 2/.test(body), 'and counts what is already ticked')
  check(body.includes(NOTE), 'the reviewer’s note still comes from the venue record alongside it')

  await context.close()
}

/* ============================================================================
   2. NEITHER NAME PRESENT — the note still arrives, no checklist
   ========================================================================= */
{
  const { page, context } = await open({ fixItems: null })
  const body = await text(page)

  check(body.includes(NOTE), 'with both read names 404ing, the note is unaffected')
  check(!/What to fix/.test(body), 'and the checklist card is absent rather than empty')
  check(!/couldn’t open this venue/i.test(body), 'nothing about this takes the page down')

  await context.close()
}

/* ============================================================================
   3. CONTACT SUPPORT ACTUALLY SENDS
   ========================================================================= */
{
  const { page, context, calls } = await open({ support: 'ack' })

  await page.getByRole('button', { name: /Contact support/i }).click()
  await page.getByLabel(/What would you like to ask/i).fill('Which photos were too small?')
  await page.getByRole('button', { name: /Send to the Sho’t Right team/i }).click()
  await page.waitForTimeout(600)

  const body = await text(page)
  check(calls.some((c) => c.includes('contact_support')), 'the message goes to contact_support')
  check(/Sent\./.test(body), 'and an acknowledged send says so')
  check(body.includes('SUP-0007'), 'quoting the reference the server gave back')

  await context.close()
}

/* ============================================================================
   4. A SILENT 200 IS NOT A DELIVERY — the assertion that matters most
   ========================================================================= */
{
  const { page, context } = await open({ support: 'silent' })

  await page.getByRole('button', { name: /Contact support/i }).click()
  await page.getByLabel(/What would you like to ask/i).fill('Which photos were too small?')
  await page.getByRole('button', { name: /Send to the Sho’t Right team/i }).click()
  await page.waitForTimeout(600)

  const body = await text(page)
  check(
    /couldn’t confirm that went through/i.test(body),
    'a 200 with no acknowledgement is NOT reported as sent',
  )
  check(!/^.*\bSent\.\s/m.test(body), 'the success wording does not appear')
  check(
    (await page.getByLabel(/What would you like to ask/i).inputValue()) ===
      'Which photos were too small?',
    'and the partner’s words are still in the box, not thrown away on a hopeful assumption',
  )

  await context.close()
}

/* ============================================================================
   5. THE BUTTON EXISTS EVEN WITH NO SUPPORT EMAIL CONFIGURED
   ========================================================================= */
{
  /* This build has no VITE_SUPPORT_EMAIL. The button used to be hidden
     entirely, which removed the primary action from the one screen where a
     partner most needs to reach a person. */
  const { page, context } = await open({ support: 'missing' })

  check(
    await page.getByRole('button', { name: /Contact support/i }).isVisible(),
    'Contact support is offered with no mail address configured',
  )

  await page.getByRole('button', { name: /Contact support/i }).click()
  await page.getByLabel(/What would you like to ask/i).fill('Please help')
  await page.getByRole('button', { name: /Send to the Sho’t Right team/i }).click()
  await page.waitForTimeout(600)

  const body = await text(page)
  check(
    /isn’t wired up on your server yet/i.test(body),
    'and if the endpoint is absent, that is said at the point of sending',
  )
  check(body.includes('VEN-00002'), 'with the reference to quote through another channel')

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

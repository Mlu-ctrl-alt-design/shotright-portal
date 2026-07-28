import { chromium } from 'playwright'

/**
 * `update_venue` REFUSES FIELDS INSTEAD OF IGNORING THEM.
 *
 * From production, 28 Jul, saving an edit:
 *
 *   ValidationError: Cannot update field(s): address, cmd, new_name,
 *                    new_venue_name
 *
 * This breaks the assumption the whole service layer is built on. Everywhere
 * else on this bench, a kwarg a method doesn't declare is dropped silently —
 * which is why we send alias families and verify by reading back. Here an
 * unrecognised key doesn't get ignored, it takes the ENTIRE SAVE down with it.
 * A partner changing their dress code lost the whole edit because we also
 * offered a rename under two speculative names.
 *
 * Note what is in that list. `new_name`/`new_venue_name` are ours. `address` is
 * a field any venue must be able to change. `cmd` is Frappe's own routing key,
 * leaking through the backend's `**frappe.form_dict` — we never sent it, and it
 * is why the retry filters on what we actually hold rather than on what the
 * error names.
 *
 * The refusal is precise and parseable, so we use it rather than guess: strip
 * exactly what was named, retry once, and tell the partner what didn't save.
 * It self-heals the day the allow-list is fixed.
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

const OLD = 'Corner Kitchen & Bar'
const VENUE = {
  name: 'VEN-00002',
  venue_name: OLD,
  address: '12 Long St, Cape Town',
  latitude: -33.92,
  longitude: 18.42,
  dress_code: 'Smart casual',
  atmosphere_desc: 'Loud and warm.',
  workflow_state: 'Approved',
  // Real enough to get past the form's own validation — a venue with no moods
  // or no open day never reaches the endpoint, and this suite is about what the
  // endpoint does.
  moods: ['MOOD-CHILLED'],
  operating_hours: [
    { day_of_week: 'Monday', open_time: '17:00', close_time: '23:00', closed: 0 },
  ],
}

/** The exact shape the bench returned. */
const refusal = (fields) => ({
  status: 417,
  json: {
    exc_type: 'ValidationError',
    exception: `frappe.exceptions.ValidationError: Cannot update field(s): ${fields.join(', ')}`,
    _server_messages: JSON.stringify([
      JSON.stringify({ message: `Cannot update field(s): ${fields.join(', ')}` }),
    ]),
  },
})

/**
 * @param refuse  field names the endpoint rejects on any request containing them
 */
async function open({ refuse = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  const stored = { ...VENUE }
  const attempts = []

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: { email: 'a@b.c' }, stats: {}, venues: [stored] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: stored } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    if (p.includes('update_venue')) {
      const body = JSON.parse(r.request().postData() || '{}')
      attempts.push(body)
      const bad = refuse.filter((f) => f in body)
      // `cmd` is always named by the real bench, whether or not we sent it.
      if (bad.length) return r.fulfill(refusal([...bad, 'cmd'].sort()))
      for (const [k, v] of Object.entries(body)) if (k !== 'venue_name') stored[k] = v
      return r.fulfill({ json: { message: { ok: true } } })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/VEN-00002/edit`, { waitUntil: 'networkidle' })
  await page.getByLabel('Venue name').waitFor()
  return { page, context, attempts, stored }
}

const save = async (page) => {
  await page.getByRole('button', { name: /Save and resubmit|Save/i }).first().click()
  await page.waitForTimeout(900)
  return page.locator('main').evaluate((n) => n.textContent)
}

/* ============================================================================
   1. THE PRODUCTION CASE — a rename against an endpoint that refuses both names
   ========================================================================= */
{
  const { page, context, attempts, stored } = await open({
    refuse: ['new_name', 'new_venue_name'],
  })

  await page.getByLabel('Venue name').fill('Corner Kitchen and Bar')
  await page.getByLabel(/Dress code/i).fill('Smart')
  const body = await save(page)

  check(attempts.length === 2, "the refusal is retried once, without the fields it named")
  check(
    !('new_name' in attempts[1]) && !('new_venue_name' in attempts[1]),
    'and the retry drops exactly those',
  )
  check(attempts[1].dress_code === 'Smart', 'while keeping the edit the partner actually made')
  check(stored.dress_code === 'Smart', 'which then saves, instead of the whole edit being lost')
  check(/still called “Corner Kitchen & Bar”/.test(body), 'the rename is reported as not taken')
  check(
    /Everything else you changed was saved/i.test(body),
    'and the rest is confirmed, so they don’t redo work that landed',
  )

  await context.close()
}

/* ============================================================================
   2. A REFUSED ORDINARY FIELD IS NAMED IN WORDS A PARTNER USES
   ========================================================================= */
{
  const { page, context, stored } = await open({ refuse: ['address'] })

  await page.getByLabel(/Address/i).first().fill('99 Bree St, Cape Town')
  await page.getByLabel(/Dress code/i).fill('Smart')
  const body = await save(page)

  check(/couldn’t update the address/i.test(body), 'the refused field is named as “the address”')
  check(!/\bcmd\b/.test(body), 'and Frappe’s own routing key is never shown to a partner')
  check(!/new_name|new_venue_name/.test(body), 'nor are our internal parameter names')
  check(stored.dress_code === 'Smart', 'the rest of the edit still saves')
  check(
    stored.address === '12 Long St, Cape Town',
    'and the address genuinely did not change — the warning is true, not defensive',
  )

  await context.close()
}

/* ============================================================================
   3. BOTH AT ONCE — two problems, two sentences, said once each
   ========================================================================= */
{
  const { page, context } = await open({
    refuse: ['address', 'new_name', 'new_venue_name'],
  })

  await page.getByLabel('Venue name').fill('Corner Kitchen and Bar')
  await page.getByLabel(/Address/i).first().fill('99 Bree St, Cape Town')
  const body = await save(page)

  check(/still called “Corner Kitchen & Bar”/.test(body), 'the rename is reported')
  check(/couldn’t update the address/i.test(body), 'and so is the address')
  check(
    (body.match(/Everything else/g) || []).length <= 1,
    '"everything else was saved" is said at most once — twice leaves them working out which is which',
  )

  await context.close()
}

/* ============================================================================
   4. A HEALTHY BENCH IS UNAFFECTED
   ========================================================================= */
{
  const { page, context, attempts, stored } = await open({ refuse: [] })

  await page.getByLabel(/Dress code/i).fill('Formal')
  const body = await save(page)

  check(attempts.length === 1, 'no retry when nothing is refused')
  check(stored.dress_code === 'Formal', 'the edit saves')
  check(!/couldn’t update/i.test(body), 'and no warning is invented')

  await context.close()
}

/* ============================================================================
   5. AN UNRELATED ERROR IS NOT SWALLOWED BY THE RETRY
   ========================================================================= */
{
  /* The retry keys on one specific message. A different failure must still
     reach the partner as a failure — a save that silently "succeeds" after a
     500 is the worst outcome available here. */
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await context.newPage()
  let calls = 0

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname
    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: { email: 'a@b.c' }, stats: {}, venues: [VENUE] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: VENUE } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })
    if (p.includes('update_venue')) {
      calls += 1
      return r.fulfill({
        status: 500,
        json: { exc_type: 'Exception', exception: 'psycopg2.OperationalError: connection lost' },
      })
    }
    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/VEN-00002/edit`, { waitUntil: 'networkidle' })
  await page.getByLabel('Venue name').waitFor()
  await page.getByLabel(/Dress code/i).fill('Formal')
  const body = await save(page)

  check(calls === 1, 'an unrelated error is not retried')
  check(
    !/Saved/i.test(body) || /didn’t save|couldn’t|error/i.test(body),
    'and is never reported as a save',
  )

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

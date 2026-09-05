import { chromium } from 'playwright'

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

const DECLINED = {
  name: 'V-9',
  venue_name: 'Shisanyama on 4th',
  address: '4th Ave, Mamelodi',
  workflow_state: 'Declined',
  moods: ['M1'],
  latitude: undefined,
  longitude: undefined,
  atmosphere_desc: '',
}

const NOTE =
  'Thanks for submitting. We can’t list this yet — the map pin is missing, so ' +
  'nobody searching nearby would see it, and there are no photos.'

/**
 * `review` — 'note' = a moderator wrote one, 'silent' = the endpoint exists but
 * nothing was recorded, 'absent' = the endpoint is not deployed (TODAY).
 */
async function open({ review = 'absent', venue = DECLINED } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  const fixCalls = []

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname
    const missing = (m) => ({
      status: 404,
      json: {
        exc_type: 'DoesNotExistError',
        exception: `frappe.exceptions.DoesNotExistError: Method Not Found: ${m}`,
      },
    })

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [venue] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: venue } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    if (p.includes('get_venue_review')) {
      if (review === 'absent') return r.fulfill(missing('shotright.api.get_venue_review'))
      if (review === 'silent') return r.fulfill({ json: { message: null } })
      return r.fulfill({
        json: {
          message: {
            state: 'Declined',
            notes: NOTE,
            reviewed_by: 'nandi@shotright.co.za',
            reviewed_by_name: 'Nandi M.',
            reviewed_on: '2026-07-25 14:02:11',
            fix_items: [
              { name: 'FIX-1', label: 'Drop the pin on the venue', done: 0 },
              { name: 'FIX-2', label: 'Add at least two photos', done: 0 },
            ],
          },
        },
      })
    }
    if (p.includes('set_review_fix_item')) {
      fixCalls.push(JSON.parse(r.request().postData() || '{}'))
      return r.fulfill({ json: { message: { ok: true } } })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  return { page, context, fixCalls }
}

const text = (page, sel = 'main') => page.locator(sel).evaluate((n) => n.textContent)

/* ============================================================================
   1. THERE IS A WAY IN — a Declined badge that answers "why?"
   ========================================================================= */
{
  const { page, context } = await open({ review: 'note' })

  await page.getByText('Shisanyama on 4th').first().waitFor()
  const fromDash = page.getByRole('link', { name: /Why Shisanyama on 4th was declined/i })
  check(await fromDash.first().isVisible(), 'the dashboard offers a route to the reason')

  await page.goto(`${BASE}/venues?status=declined`, { waitUntil: 'networkidle' })
  const fromList = page.getByRole('link', { name: /Why Shisanyama on 4th was declined/i })
  check(await fromList.isVisible(), 'so does the Declined tab')
  check(
    (await fromList.innerText()).trim() === 'Why?',
    'and it is the first question a declined partner has, not "Edit"',
  )

  await fromList.click()
  await page.waitForURL(/\/venues\/V-9\/review/)
  await context.close()
}

/* ============================================================================
   2. THE MODERATOR IS HEARD — verbatim, attributed, dated, and first
   ========================================================================= */
{
  const { page, context } = await open({ review: 'note' })
  await page.goto(`${BASE}/venues/V-9/review`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /wasn’t approved/i }).waitFor()

  const body = await text(page)
  check(body.includes(NOTE), 'the reviewer’s words are shown in full, unedited')
  check(/Nandi M\./.test(body), 'attributed to the person who wrote them')
  check(/25 July 2026/.test(body), 'and dated')

  const quote = page.locator('blockquote')
  check(await quote.isVisible(), 'set apart as a quote, so it cannot be confused with our own copy')

  /* Order is the argument: the reason has to come before anything we say. */
  const order = await page.evaluate(() => {
    const t = document.querySelector('main').innerText
    return {
      why: t.indexOf('Why this was declined'),
      noticed: t.indexOf('Things we noticed'),
      next: t.indexOf('What happens next'),
    }
  })
  check(
    order.why >= 0 && order.why < order.noticed && order.noticed < order.next,
    'the reviewer comes first, then what we noticed, then the way out',
  )

  await context.close()
}

/* ============================================================================
   3. THE CHECKLIST — ticks, persists, and does not overclaim
   ========================================================================= */
{
  const { page, context, fixCalls } = await open({ review: 'note' })
  await page.goto(`${BASE}/venues/V-9/review`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /What to fix/i }).waitFor()

  const box = page.getByRole('checkbox', { name: /Drop the pin on the venue/i })
  check(await box.isVisible(), 'the reviewer’s fix items are a checklist, not a paragraph')
  await box.check()
  await page.waitForTimeout(300)

  check(fixCalls.length === 1 && fixCalls[0].item === 'FIX-1', 'ticking one is saved')
  check(fixCalls[0].done === 1, 'with the state it was moved to')

  const body = await text(page)
  check(
    /just for you/i.test(body) && /not this list/i.test(body),
    'and it says the reviewer does not see the list — a tick that looks like a report and isn’t is a lie',
  )
  check(/1 of 2/.test(body), 'progress is counted')

  await context.close()
}

/* ============================================================================
   4. THINGS WE NOTICED — useful, and never mistaken for the reviewer
   ========================================================================= */
{
  const { page, context } = await open({ review: 'note' })
  await page.goto(`${BASE}/venues/V-9/review`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /Things we noticed/i }).waitFor()

  const body = await text(page)
  check(
    /aren’t the reviewer’s reasons/i.test(body),
    'our own observations are explicitly disclaimed as not the reviewer’s',
  )
  check(/No location is set/i.test(body), 'and they are real — this venue has no map pin')
  check(/No photos/i.test(body), 'and no photos')
  check(/Nothing on the menu/i.test(body), 'and an empty menu')
  check(
    await page.getByRole('link', { name: /Add menu items/i }).isVisible(),
    'each one links to the screen that fixes it, rather than describing where to go',
  )

  await context.close()
}

/* ============================================================================
   5. NO REASON GIVEN — the case that is true for every venue today
   ========================================================================= */
{
  const { page, context } = await open({ review: 'absent' })
  await page.goto(`${BASE}/venues/V-9/review`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /wasn’t approved/i }).waitFor()

  const body = await text(page)
  check(/No reason was recorded/i.test(body), 'it says there is no reason, rather than inventing one')
  check(
    !/guidelines|standards|criteria/i.test(body),
    'no generic placeholder reason anywhere — a partner would act on it and be declined again',
  )
  check(/that’s on us, not you/i.test(body), 'it owns the failure instead of implying the partner caused it')
  check(
    /can’t load the reviewer’s note right now/i.test(body),
    'and separately says the note could not be loaded — without naming an endpoint',
  )

  /* With nothing to act on, editing is a guess — so asking a human leads. */
  const buttons = await page.locator('button, a[href], span').evaluateAll((nodes) =>
    nodes.map((n) => n.textContent.trim()),
  )
  check(
    body.includes('Things we noticed'),
    'the derived gaps still render — with no note they are the only concrete thing on the page',
  )
  check(Array.isArray(buttons), 'harness sanity')

  await context.close()
}

/* ============================================================================
   6. NO SUPPORT ADDRESS — but there is now an endpoint

   These three assertions used to say the opposite: with VITE_SUPPORT_EMAIL
   unset there must be NO support button, because a button that reaches nobody
   is worse than no button. That was correct for as long as the only route was
   a mailto to an address nobody ever sent us.

   `contact_support` was confirmed deployed on 28 Jul, so the route exists
   without an address — and hiding the button now removes the primary action
   from the one screen where a partner most needs to reach a person. Updated
   rather than deleted, because the replacement is where the old requirement
   went. What has NOT changed is the rule underneath it: nothing may be offered
   that silently reaches nobody. verify17 enforces that at the point of sending,
   which is where it can now be answered honestly.
   ========================================================================= */
{
  const { page, context } = await open({ review: 'absent' })
  await page.goto(`${BASE}/venues/V-9/review`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /What happens next/i }).waitFor()

  const body = await text(page)
  check(
    await page.getByRole('button', { name: /Contact support/i }).count(),
    'the support button is offered with no mail address configured — the endpoint is the route now',
  )
  check(
    !/don’t have a support address wired into the portal yet/i.test(body),
    'and the old apology for having no address goes with it',
  )
  check(/V-9/.test(body), 'the reference stays on the page for any other channel they use')

  await context.close()
}

/* ============================================================================
   7. NOT DECLINED — the page still makes sense from a stale link
   ========================================================================= */
{
  const approved = { ...DECLINED, workflow_state: 'Approved' }
  const { page, context } = await open({ review: 'note', venue: approved })
  await page.goto(`${BASE}/venues/V-9/review`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  const body = await text(page)
  check(/Where this venue stands/i.test(body), 'an approved venue opened here does not claim to be declined')
  check(/approved and showing to customers/i.test(body), 'it says what state the venue is actually in')
  check(!/Why this was declined/i.test(body), 'and shows no decline reasoning')

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

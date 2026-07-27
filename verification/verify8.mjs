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

async function open({ venues, stats = {} }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    if (u.pathname.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (u.pathname.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (u.pathname.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats, venues } } })
    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  return { page, context }
}

const rows = (page) => page.locator('tbody tr td:first-child p:first-child').allInnerTexts()
const tabText = (page) =>
  page.locator('nav[aria-label="Filter venues by status"]').innerText().then((t) => t.replace(/\n/g, ' '))

const venue = (name, state) => ({
  name: `V-${name}`,
  venue_name: name,
  workflow_state: state,
  address: 'somewhere',
})

/* ===== THE REPORTED BUG: the bench says "Declined", not "Rejected" ===== */
{
  const { page, context } = await open({
    venues: [venue('The Rooftop', 'Approved'), venue('Late Night', 'Declined')],
  })

  await page.goto(`${BASE}/venues?status=declined`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  check(
    JSON.stringify(await rows(page)) === JSON.stringify(['Late Night']),
    'a venue whose state is literally "Declined" now shows under Declined',
  )
  check(/Declined\s*1/.test(await tabText(page)), 'and the tab counts it')

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.getByText(/Welcome back/).waitFor()
  const dash = await page.locator('main').innerText()
  // innerText applies text-transform, so the tile label reads DECLINED.
  check(/DECLINED\s*1/i.test(dash.replace(/\n/g, ' ')), 'the dashboard tile counts it too')
  check(
    !/Rejected/.test(dash),
    'and nothing anywhere still says "Rejected" — one word per state',
  )
  await context.close()
}

/* ===== the old value must keep working ===== */
{
  const { page, context } = await open({ venues: [venue('Late Night', 'Rejected')] })
  await page.goto(`${BASE}/venues?status=declined`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  check((await rows(page)).length === 1, '"Rejected" still lands under Declined — no regression')
  await context.close()
}

/* ===== other plausible words the bench might use ===== */
{
  for (const [state, bucket] of [
    ['rejected', 'declined'],
    ['Not Approved', 'declined'],
    ['Denied', 'declined'],
    ['Pending Review', 'pending'],
    ['Draft', 'pending'],
    ['Submitted', 'pending'],
    ['Active', 'approved'],
    ['Live', 'approved'],
  ]) {
    const { page, context } = await open({ venues: [venue('X', state)] })
    await page.goto(`${BASE}/venues?status=${bucket}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    check((await rows(page)).length === 1, `"${state}" is matched into ${bucket}`)
    await context.close()
  }
}

/* ===== an unrecognised state is never invisible ===== */
{
  const { page, context } = await open({
    venues: [venue('The Rooftop', 'Approved'), venue('Odd One', 'On Hold')],
  })

  await page.goto(`${BASE}/venues`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const body = await page.locator('main').innerText()
  check(
    /doesn’t recognise yet/.test(body) && /On Hold/.test(body),
    'an unrecognised status is reported BY NAME rather than silently dropped',
  )
  check((await rows(page)).includes('Odd One'), 'and the venue is still listed under All')
  check(
    (await page.locator('tbody').innerText()).includes('On Hold'),
    'with its real status shown, so the mismatch is recognisable',
  )

  await page.goto(`${BASE}/venues?status=declined`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  check(
    /doesn’t recognise yet/.test(await page.locator('main').innerText()),
    'the warning follows onto an empty tab — where the ambiguity actually bites',
  )
  await context.close()
}

/* ===== backend counts what it does not send ===== */
{
  const { page, context } = await open({
    venues: [venue('The Rooftop', 'Approved')],
    stats: { total: 2, approved: 1, pending: 0, rejected: 1 },
  })
  await page.goto(`${BASE}/venues?status=declined`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const body = await page.locator('main').innerText()
  check(
    /did\s+not send/.test(body.replace(/\n/g, ' ')),
    'a backend that COUNTS a declined venue but does not RETURN it is reported',
  )
  check(
    /fault on our side/.test(body),
    'and framed as our bug, not something the partner did wrong',
  )
  await context.close()
}

/* ===== no false alarm when everything agrees ===== */
{
  const { page, context } = await open({
    venues: [venue('The Rooftop', 'Approved'), venue('Late Night', 'Declined')],
    stats: { total: 2, approved: 1, pending: 0, rejected: 1 },
  })
  await page.goto(`${BASE}/venues?status=declined`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const body = await page.locator('main').innerText()
  check(!/did\s+not send/.test(body.replace(/\n/g, ' ')), 'no mismatch warning when counts agree')
  check(!/doesn’t recognise/.test(body), 'and no unrecognised-status warning either')
  await context.close()
}

/* ===== genuinely nothing declined still reads as nothing declined ===== */
{
  const { page, context } = await open({
    venues: [venue('The Rooftop', 'Approved')],
    stats: { total: 1, approved: 1, pending: 0, rejected: 0 },
  })
  await page.goto(`${BASE}/venues?status=declined`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const body = await page.locator('main').innerText()
  check(/Nothing declined/.test(body), 'an genuinely empty Declined tab still says so')
  check(!/did not send/.test(body) && !/doesn’t recognise/.test(body), 'with no spurious warnings')
  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

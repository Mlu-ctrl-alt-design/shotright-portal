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

const VENUES = [
  { name: 'V1', venue_name: 'The Rooftop', workflow_state: 'Approved', address: 'Braam' },
  { name: 'V2', venue_name: 'Kota King', workflow_state: 'Approved', address: 'Soweto' },
  { name: 'V3', venue_name: 'Sunset Grill', workflow_state: 'Pending', address: 'Sandton' },
  { name: 'V4', venue_name: 'Late Night', workflow_state: 'Rejected', address: 'Melville' },
]
const DASH = {
  profile: { email: 'a@b.c', vendor_name: 'Thabo M', business_name: 'Kota King' },
  stats: { total: 4, approved: 2, pending: 1, rejected: 1 },
  venues: VENUES,
}

const signedIn = async (viewport = { width: 1280, height: 900 }) => {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    if (u.pathname.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (u.pathname.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (u.pathname.includes('get_vendor_dashboard')) return r.fulfill({ json: { message: DASH } })
    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.getByText('Your venues').waitFor({ timeout: 15000 })
  return page
}

const ROWS = 'tbody tr td:first-child p:first-child'
const rowNames = (page) => page.locator(ROWS).allInnerTexts()

/**
 * Read the table only once it matches `expected`.
 *
 * Waiting on the URL is not enough: two tabs can hold the same NUMBER of rows,
 * so a stale read looks plausible and the assertion passes or fails at random.
 * This polls the actual contents.
 */
const rowsSettle = async (page, expected) => {
  await page
    .locator(ROWS)
    .filter({ hasText: expected[0] })
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {})
  for (let i = 0; i < 25; i++) {
    const names = await rowNames(page)
    if (JSON.stringify(names) === JSON.stringify(expected)) return names
    await page.waitForTimeout(100)
  }
  return rowNames(page)
}

/* ============ nav is smaller and stable ============ */
{
  const page = await signedIn()
  const nav = await page.locator('aside nav').innerText()
  const items = nav.split('\n').map((s) => s.trim()).filter(Boolean)

  check(
    !items.includes('Declined') && !items.includes('Pending'),
    `states are out of the nav (nav is: ${items.join(', ')})`,
  )
  check(items.includes('My Venues'), 'nav has a single My Venues destination')
  check(items.length === 4, `nav is 4 items, down from 5 (got ${items.length})`)

  // My Venues must not stay lit while you are somewhere else under /venues.
  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  const activeOnWizard = await page
    .locator('aside nav a[aria-current="page"]')
    .innerText()
    .catch(() => '')
  check(
    activeOnWizard.includes('Add New'),
    `nav highlights Add New inside the wizard, not My Venues (got "${activeOnWizard.trim()}")`,
  )

  await page.goto(`${BASE}/venues?status=pending`, { waitUntil: 'networkidle' })
  const activeOnFilter = await page.locator('aside nav a[aria-current="page"]').innerText()
  check(
    activeOnFilter.includes('My Venues'),
    'nav stays on My Venues while a status filter is applied',
  )
  await page.close()
}

/* ============ tabs filter the one list ============ */
{
  const page = await signedIn()
  await page.goto(`${BASE}/venues`, { waitUntil: 'networkidle' })

  const tabs = page.locator('nav[aria-label="Filter venues by status"] a')
  check((await tabs.count()) === 4, 'four tabs: All, Approved, Pending, Declined')

  const tabText = await page.locator('nav[aria-label="Filter venues by status"]').innerText()
  check(/All\s*4/.test(tabText.replace(/\n/g, ' ')), 'All tab shows a count of 4')
  check(/Approved\s*2/.test(tabText.replace(/\n/g, ' ')), 'Approved shows 2')
  check(/Pending\s*1/.test(tabText.replace(/\n/g, ' ')), 'Pending shows 1')
  check(/Declined\s*1/.test(tabText.replace(/\n/g, ' ')), 'Declined shows 1')

  check((await rowNames(page)).length === 4, 'All shows every venue')

  await tabs.filter({ hasText: 'Pending' }).click()
  await page.waitForURL('**/venues?status=pending')
  check(
    JSON.stringify(await rowsSettle(page, ['Sunset Grill'])) === JSON.stringify(['Sunset Grill']),
    'Pending filters to the one pending venue',
  )
  check(
    (await tabs.filter({ hasText: 'Pending' }).getAttribute('aria-current')) === 'page',
    'the selected tab is aria-current, not colour-only (WCAG 1.4.1)',
  )
  check(
    (await tabs.filter({ hasText: 'Approved' }).getAttribute('aria-current')) === null,
    'unselected tabs are not aria-current',
  )

  await tabs.filter({ hasText: 'Declined' }).click()
  await page.waitForURL('**/venues?status=declined')
  check(
    JSON.stringify(await rowsSettle(page, ['Late Night'])) === JSON.stringify(['Late Night']),
    'Declined maps the "Declined" label onto workflow_state Rejected',
  )

  // Back/forward must work — that is the reason these are links, not tabs.
  await page.goBack()
  await page.waitForURL('**/venues?status=pending')
  check(
    JSON.stringify(await rowsSettle(page, ['Sunset Grill'])) === JSON.stringify(['Sunset Grill']),
    'browser Back returns to the previous filter',
  )
  await page.goForward()
  await page.waitForURL('**/venues?status=declined')
  check((await rowsSettle(page, ['Late Night']))[0] === 'Late Night', 'browser Forward works too')
  check(
    (await page.locator('tbody').innerText()).includes('Declined') &&
      !(await page.locator('tbody').innerText()).includes('Rejected'),
    'the row badge says Declined too, not Rejected — one word per state',
  )

  // Deep link.
  await page.goto(`${BASE}/venues?status=approved`, { waitUntil: 'networkidle' })
  check((await rowNames(page)).length === 2, 'a filter URL is shareable / bookmarkable')

  // Junk value must not read as "you have no venues".
  await page.goto(`${BASE}/venues?status=banana`, { waitUntil: 'networkidle' })
  check(
    (await rowNames(page)).length === 4,
    'an unknown status falls back to All rather than showing an empty list',
  )
  await page.close()
}

/* ============ old URLs still work ============ */
{
  const page = await signedIn()
  await page.goto(`${BASE}/venues/pending`, { waitUntil: 'networkidle' })
  check(
    page.url().endsWith('/venues?status=pending'),
    `bookmarked /venues/pending redirects (landed on ${page.url()})`,
  )
  check((await rowsSettle(page, ['Sunset Grill']))[0] === 'Sunset Grill', 'and shows the right venues')

  await page.goto(`${BASE}/venues/declined`, { waitUntil: 'networkidle' })
  check(page.url().endsWith('/venues?status=declined'), 'bookmarked /venues/declined redirects')
  await page.close()
}

/* ============ dashboard tiles lead somewhere ============ */
{
  const page = await signedIn()
  await page.getByText('Pending review').click()
  await page.waitForURL('**/venues?status=pending')
  check(true, 'the "Pending review" dashboard tile opens that tab')
  check((await rowsSettle(page, ['Sunset Grill']))[0] === 'Sunset Grill', 'and lands on the right list')
  await page.close()
}

/* ============ mobile ============ */
{
  const page = await signedIn({ width: 390, height: 844 })
  await page.goto(`${BASE}/venues`, { waitUntil: 'networkidle' })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  check(overflow <= 0, `no horizontal page overflow at 390px (${overflow}px)`)

  const tab = page.locator('nav[aria-label="Filter venues by status"] a').first()
  const box = await tab.boundingBox()
  check(box.height >= 40, `tabs are a usable touch target (${Math.round(box.height)}px tall)`)

  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('dialog').waitFor()
  const drawer = await page.getByRole('dialog').innerText()
  check(
    !/Declined|Pending/.test(drawer),
    `the drawer lost the state entries too (drawer: ${drawer.replace(/\s+/g, ' ').trim()})`,
  )
  await page.keyboard.press('Escape')

  await page.screenshot({ path: 'venues-mobile.png', fullPage: true })
  await page.close()
}

{
  const page = await signedIn()
  await page.goto(`${BASE}/venues`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: 'venues-desktop.png' })
  await page.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

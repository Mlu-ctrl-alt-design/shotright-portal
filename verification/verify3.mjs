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

const DASH = {
  profile: { email: 'a@b.c', vendor_name: 'Thabo M', business_name: 'Kota King' },
  venues: [],
}

const signedIn = async (viewport) => {
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

/* ==================== MOBILE ==================== */
{
  const page = await signedIn({ width: 390, height: 844 })
  const trigger = page.getByRole('button', { name: 'Open menu' })
  const dialog = page.getByRole('dialog')

  check((await trigger.count()) === 1, 'mobile header has a menu trigger')
  check((await trigger.getAttribute('aria-expanded')) === 'false', 'trigger reports collapsed')

  // The nav items must NOT be sitting in the header any more.
  const header = await page.locator('header').first().innerText()
  check(
    !/Declined|Pending|Settings/.test(header),
    `nav items are out of the header (header reads: "${header.replace(/\s+/g, ' ').trim()}")`,
  )

  const box = await page.locator('header').first().boundingBox()
  check(box.height < 80, `header is compact (${Math.round(box.height)}px)`)

  check((await dialog.count()) === 0, 'drawer is not in the DOM until opened')

  // --- open ---
  await trigger.click()
  await dialog.waitFor({ timeout: 5000 })
  check((await trigger.getAttribute('aria-expanded')) === 'true', 'trigger reports expanded')
  check((await dialog.getAttribute('aria-modal')) === 'true', 'drawer is aria-modal')
  check(Boolean(await dialog.getAttribute('aria-label')), 'drawer has an accessible name')

  const drawerText = await dialog.innerText()
  check(
    ['Dashboard', 'My Venues', 'Add New', 'Settings', 'Logout'].every((l) =>
      drawerText.includes(l),
    ),
    'drawer carries every nav item plus Logout',
  )

  // Focus starts on the dialog so a screen reader announces it before the links.
  check(
    await page.evaluate(() => document.activeElement?.getAttribute('role') === 'dialog'),
    'focus moves into the drawer on open',
  )

  // Body scroll is locked.
  check(
    await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'),
    'page behind is scroll-locked',
  )

  // --- focus trap: Tab must never escape ---
  const visited = new Set()
  let escaped = false
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      return d?.contains(document.activeElement)
    })
    if (!inside) escaped = true
    visited.add(
      await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 20) || '?'),
    )
  }
  check(!escaped, 'Tab is trapped inside the drawer (14 presses, forwards)')

  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Shift+Tab')
    const inside = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      return d?.contains(document.activeElement)
    })
    if (!inside) escaped = true
  }
  check(!escaped, 'Shift+Tab is trapped too (the end most implementations forget)')

  // --- Escape closes and restores focus ---
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'Escape closes the drawer')
  check(
    await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') === 'Open menu',
    ),
    'focus returns to the trigger, not the top of the document',
  )
  check(
    await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'),
    'scroll lock is released on close',
  )

  // --- backdrop click closes ---
  await trigger.click()
  await dialog.waitFor()
  await page.mouse.click(370, 400) // far right, over the backdrop
  await dialog.waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'tapping outside closes the drawer')

  // --- navigating closes it ---
  await trigger.click()
  await dialog.waitFor()
  await page.getByRole('dialog').getByRole('link', { name: /Settings/ }).click()
  await dialog.waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'choosing a destination closes the drawer')
  check(new URL(page.url()).pathname === '/profile', 'and actually navigates')

  // --- close button ---
  await trigger.click()
  await dialog.waitFor()
  await page.getByRole('button', { name: 'Close menu' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 5000 })
  check(true, 'the close button closes it')

  // --- touch targets ---
  const t = await trigger.boundingBox()
  check(t.width >= 44 && t.height >= 44, `trigger meets the 44px target (${t.width}x${t.height})`)

  // --- resizing to desktop must not strand a scroll lock ---
  await trigger.click()
  await dialog.waitFor()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(300)
  check(
    await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'),
    'resizing to desktop while open releases the scroll lock',
  )

  await page.close()
}

/* ==================== DESKTOP ==================== */
{
  const page = await signedIn({ width: 1280, height: 900 })
  check(
    (await page.getByRole('button', { name: 'Open menu' }).count()) === 0 ||
      !(await page.getByRole('button', { name: 'Open menu' }).isVisible()),
    'no menu trigger on desktop',
  )
  const sidebar = page.locator('aside')
  check(await sidebar.isVisible(), 'desktop keeps the permanent sidebar')
  const sideText = await sidebar.innerText()
  check(
    ['Dashboard', 'My Venues', 'Add New', 'Settings', 'Logout'].every((l) =>
      sideText.includes(l),
    ),
    'sidebar still shows every item by default',
  )
  await page.screenshot({ path: 'nav-desktop.png' })
  await page.close()
}

/* ============ screenshots of the drawer ============ */
{
  const page = await signedIn({ width: 390, height: 844 })
  await page.screenshot({ path: 'nav-mobile-closed.png' })
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(350)
  await page.screenshot({ path: 'nav-mobile-open.png' })
  await page.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

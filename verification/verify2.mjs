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
  profile: { email: 'real@bench.example', vendor_name: 'Real Person', business_name: 'REAL CO' },
  venues: [{ name: 'VEN-1', venue_name: 'REAL VENUE', workflow_state: 'Approved', address: 'x' }],
}

/**
 * `bench` describes which endpoints exist. Missing ones answer 404, exactly as
 * Frappe does for an undeployed whitelisted method — which is what the portal's
 * capability detection keys off.
 */
function makeRoute(page, bench, seen) {
  return page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const method = url.pathname.replace('/api/method/', '')
    seen.push(method)

    if (url.pathname.startsWith('/api/resource/Mood')) {
      return route.fulfill({
        json: { data: [{ name: 'M1', mood_name: 'Chilled Bar' }, { name: 'M2', mood_name: 'Rooftop' }] },
      })
    }
    if (!(method in bench)) {
      return route.fulfill({
        status: 404,
        json: { exc_type: 'DoesNotExistError', message: 'Method not found' },
      })
    }
    const value = bench[method]
    const body = typeof value === 'function' ? value(route.request()) : value
    if (body?.__status) return route.fulfill({ status: body.__status, json: body })
    return route.fulfill({ json: { message: body } })
  })
}

const newPage = async (bench) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const seen = []
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))
  await makeRoute(page, bench, seen)
  return { page, seen }
}

/* ================================================================
   A. OTP absent — registration must behave exactly as it does today
   ================================================================ */
{
  const { page, seen } = await newPage({
    'shotright.api.register_vendor': { api_key: 'K', api_secret: 'S' },
    'shotright.api.get_vendor_dashboard': DASH,
  })
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  await page.getByLabel('Name', { exact: true }).fill('Thabo')
  await page.getByLabel('Surname').fill('M')
  await page.getByLabel('Email').fill('t@example.com')
  await page.getByLabel('Business name').fill('Kota King')
  await page.getByLabel('Password', { exact: true }).fill('Sh0tRight!2026')
  await page.getByLabel('Confirm password').fill('Sh0tRight!2026')
  await page.getByRole('button', { name: 'Register' }).click()

  await page.getByText('Your venues').waitFor({ timeout: 15000 })
  check(new URL(page.url()).pathname === '/', 'no-OTP backend: register signs in directly (no regression)')
  check(!seen.includes('shotright.api.verify_otp'), 'no-OTP backend: verify_otp never called')
  await page.close()
}

/* ================================================================
   B. OTP present — the code screen appears with no frontend release
   ================================================================ */
{
  const { page, seen } = await newPage({
    'shotright.api.register_vendor': { otp_required: true, email: 't@example.com' },
    'shotright.api.verify_otp': (req) => {
      const body = JSON.parse(req.postData() || '{}')
      if (body.code !== '123456') return { __status: 417, message: 'That code is not correct.' }
      return { api_key: 'K', api_secret: 'S' }
    },
    'shotright.api.resend_otp': { sent: true, cooldown_seconds: 60 },
    'shotright.api.get_vendor_dashboard': DASH,
  })

  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
  await page.getByLabel('Name', { exact: true }).fill('Thabo')
  await page.getByLabel('Surname').fill('M')
  await page.getByLabel('Email').fill('t@example.com')
  await page.getByLabel('Business name').fill('Kota King')
  await page.getByLabel('Password', { exact: true }).fill('Sh0tRight!2026')
  await page.getByLabel('Confirm password').fill('Sh0tRight!2026')
  await page.getByRole('button', { name: 'Register' }).click()

  await page.getByText('Check your email').waitFor({ timeout: 15000 })
  check(new URL(page.url()).pathname === '/verify', 'OTP backend: routed to the code screen')
  check(
    !page.url().includes('t@example.com'),
    'the email is NOT in the URL (no history/Referer leak)',
  )
  check(
    (await page.locator('body').innerText()).includes('t@example.com'),
    'the address is shown on screen so a typo is catchable',
  )

  const otp = page.locator('#otp')
  check(
    (await otp.getAttribute('autocomplete')) === 'one-time-code',
    'code field opts into platform OTP autofill',
  )
  check((await otp.getAttribute('inputmode')) === 'numeric', 'code field gets the numeric keypad')

  // Wrong code: reports, clears, stays put.
  await otp.fill('000000')
  await page.getByText('That code is not correct.').waitFor({ timeout: 10000 })
  check(true, 'wrong code surfaces the backend message')
  check((await otp.inputValue()) === '', 'wrong code is cleared ready for the next attempt')
  check(new URL(page.url()).pathname === '/verify', 'wrong code does not navigate away')

  // Non-digits rejected at entry.
  await otp.fill('abc12x')
  check((await otp.inputValue()) === '12', 'non-digits are stripped')

  // Right code: auto-submits on the 6th digit.
  await otp.fill('123456')
  await page.getByText('Your venues').waitFor({ timeout: 15000 })
  check(new URL(page.url()).pathname === '/', 'correct code signs in and lands on the dashboard')
  check(seen.includes('shotright.api.verify_otp'), 'verify_otp was actually called')
  await page.close()
}

/* ================================================================
   C. Moods — vendor-authored, and the smart default
   ================================================================ */
{
  const { page, seen } = await newPage({
    'shotright.api.login': { api_key: 'K', api_secret: 'S' },
    'shotright.api.get_vendor_dashboard': DASH,
    'shotright.api.get_popular_moods': [
      { name: 'M1', mood_name: 'Chilled Bar', venue_count: 42 },
      { name: 'M2', mood_name: 'Rooftop', venue_count: 17 },
    ],
    'shotright.api.resolve_mood': (req) => {
      const body = JSON.parse(req.postData() || '{}')
      if (/chilled/i.test(body.text)) return { status: 'canonical', mood: 'M1', label: 'Chilled Bar' }
      return { status: 'suggested', mood: 'MSUG-1', label: body.text, near: null }
    },
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.getByText('Your venues').waitFor({ timeout: 15000 })

  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  await page.getByText('Most used by venues').waitFor({ timeout: 15000 })
  check(true, 'popular moods are front-loaded before anything is typed')
  check(
    (await page.locator('body').innerText()).includes('42'),
    'popular moods show how many venues use them',
  )

  // A brand-new mood is ACCEPTED and marked pending, not refused.
  await page.getByLabel('Mood').fill('Amapiano Sundays')
  await page.getByRole('button', { name: /^Add/ }).click()

  // Scope to the step's own region — the sidebar has a "Pending" nav link.
  const pill = page.locator('main').getByText('Amapiano Sundays', { exact: false }).first()
  await pill.waitFor({ timeout: 10000 })
  const main = await page.locator('main').innerText()
  check(main.includes('Amapiano Sundays'), 'a vendor-authored mood is added to the venue')
  check(/pending/i.test(main), 'it is visibly marked pending, not shown as a normal mood')
  check(main.includes('review'), 'the partner is told what pending means without leaving the step')
  check(seen.includes('shotright.api.resolve_mood'), 'resolve_mood was called')
  await page.close()
}

/* ================================================================
   D. resolve_mood ABSENT — must refuse, not silently accept
   ================================================================ */
{
  const { page } = await newPage({
    'shotright.api.login': { api_key: 'K', api_secret: 'S' },
    'shotright.api.get_vendor_dashboard': DASH,
  })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.getByText('Your venues').waitFor({ timeout: 15000 })

  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  await page.getByLabel('Mood').fill('Amapiano Sundays')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.getByText(/doesn.t have/i).waitFor({ timeout: 10000 })
  check(true, 'old backend: an unknown mood is refused at entry, not accepted-then-dropped')

  // The canonical list still works via the resource-API fallback.
  await page.getByLabel('Mood').fill('Chilled Bar')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.getByText('added').waitFor({ timeout: 10000 })
  check(true, 'old backend: a canonical mood still resolves')
  await page.close()
}

/* ================================================================
   E. Operating hours on mobile, and no login prefill
   ================================================================ */
{
  const HOURS = [
    ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => ({
      day_of_week: d, open_time: '09:00:00', close_time: '22:00:00', closed: 0,
    })),
    { day_of_week: 'Saturday', open_time: '10:00:00', close_time: '23:00:00', closed: 0 },
    { day_of_week: 'Sunday', open_time: '', close_time: '', closed: 1 },
  ]
  const { page } = await newPage({
    'shotright.api.login': { api_key: 'K', api_secret: 'S' },
    'shotright.api.get_vendor_dashboard': DASH,
    'shotright.api.get_venue_detail': {
      name: 'VEN-1', venue_name: 'REAL VENUE', workflow_state: 'Approved',
      moods: [], operating_hours: HOURS,
    },
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  check((await page.getByLabel('Email').inputValue()) === '', 'login email is never prefilled')
  check((await page.getByLabel('Password').inputValue()) === '', 'login password is never prefilled')
  check(
    (await page.getByRole('link', { name: /forgot/i }).count()) === 1,
    'login offers a password reset route',
  )

  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.getByText('Your venues').waitFor({ timeout: 15000 })

  await page.goto(`${BASE}/venues/VEN-1/edit`, { waitUntil: 'networkidle' })
  await page.getByText('Operating hours').waitFor({ timeout: 15000 })

  const timeInputs = await page.locator('input[type="time"]').count()
  check(timeInputs === 6, `7 days collapse to 3 bands = 6 time inputs (got ${timeInputs})`)

  const labels = await page.locator('input[type="time"]').evaluateAll((ns) =>
    ns.map((n) => n.getAttribute('aria-label')),
  )
  check(
    labels.some((l) => l?.startsWith('Mon – Fri')),
    `weekdays render as one band (labels: ${labels.join(', ')})`,
  )
  check(labels.some((l) => l?.startsWith('Sunday')), 'the closed day stays its own band')

  // The point of the change: it has to fit on a phone.
  const card = page.locator('section,div').filter({ hasText: 'Operating hours' }).last()
  const box = await card.boundingBox()
  check(box.height < 520, `hours block fits a phone screen (${Math.round(box.height)}px tall)`)

  // Escape hatch for irregular weeks.
  await page.getByRole('button', { name: /day by day/i }).click()
  const perDay = await page.locator('input[type="time"]').count()
  check(perDay === 14, `"Edit day by day" exposes all 7 days (${perDay} inputs)`)

  // No horizontal overflow at 390px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  check(overflow <= 0, `no horizontal overflow at 390px (overflow ${overflow}px)`)

  await page.screenshot({ path: 'hours-mobile.png', fullPage: true })
  await page.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

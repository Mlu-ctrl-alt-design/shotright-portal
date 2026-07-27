import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:4173'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const apiCalls = []
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

// Stand in for the bench: record every call the prod build makes, and answer
// with data that is unmistakably NOT the fixtures.
await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url())
  const method = url.pathname.replace('/api/method/', '')
  apiCalls.push(method)

  if (method.endsWith('shotright.api.login')) {
    return route.fulfill({
      json: { message: { api_key: 'K', api_secret: 'S' } },
    })
  }
  if (method.endsWith('shotright.api.get_vendor_dashboard')) {
    return route.fulfill({
      json: {
        message: {
          profile: { email: 'real@bench.example', business_name: 'REAL BENCH CO' },
          stats: { total: 1, approved: 1, pending: 0, rejected: 0 },
          venues: [
            {
              name: 'VEN-REAL-1',
              venue_name: 'REAL BENCH VENUE',
              workflow_state: 'Approved',
              address: 'From the bench',
            },
          ],
        },
      },
    })
  }
  if (url.pathname.startsWith('/api/resource/Mood')) {
    return route.fulfill({ json: { data: [{ name: 'M1', mood_name: 'Bench Mood' }] } })
  }
  return route.fulfill({ json: { message: {} } })
})

const fail = []
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) fail.push(label)
}

/* ------------------------------------------------- 1. login: no mock prefill */
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })

const emailValue = await page.getByLabel('Email').inputValue()
check(emailValue === '', `login email is empty, not the fixture prefill (got "${emailValue}")`)

/* ------------------------------------------- 2. password toggle on the login */
const loginPw = page.getByLabel('Password')
check((await loginPw.getAttribute('type')) === 'password', 'login password starts masked')
// The accessible name flips Show -> Hide by design, so hold a stable handle.
const loginToggle = page.locator('button[aria-pressed]')
await loginPw.fill('hunter2')
await page.getByRole('button', { name: /^show$/i }).click()
check((await loginPw.getAttribute('type')) === 'text', 'login password reveals on Show')
check(
  (await loginToggle.getAttribute('aria-pressed')) === 'true',
  'login toggle reports aria-pressed=true',
)
check(
  (await page.getByRole('button', { name: /^hide$/i }).count()) === 1,
  'login toggle label flips to Hide',
)
await page.getByRole('button', { name: /^hide$/i }).click()
check(
  (await loginToggle.getAttribute('aria-pressed')) === 'false',
  'login toggle reports aria-pressed=false again',
)
check((await loginPw.getAttribute('type')) === 'password', 'login password re-masks on Hide')

/* ---------------------------------- 3. register: both fields toggle SEPARATELY */
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
const pw = page.getByLabel('Password', { exact: true })
const confirm = page.getByLabel('Confirm password')
await pw.fill('Sh0tRight!2026')
await confirm.fill('Sh0tRight!2027')

const toggles = page.getByRole('button', { name: /^(show|hide)$/i })
check((await toggles.count()) === 2, 'register has a toggle on both password fields')

check((await pw.getAttribute('type')) === 'password', 'register password starts masked')
check((await confirm.getAttribute('type')) === 'password', 'register confirm starts masked')

await toggles.nth(0).click()
check((await pw.getAttribute('type')) === 'text', 'register password reveals')
check(
  (await confirm.getAttribute('type')) === 'password',
  'revealing password does NOT reveal confirm (independent toggles)',
)
await toggles.nth(1).click()
check((await confirm.getAttribute('type')) === 'text', 'register confirm reveals independently')

// aria-controls must point at the field it governs, not the other one.
const controls = await toggles.nth(0).getAttribute('aria-controls')
const pwId = await pw.getAttribute('id')
check(controls === pwId, `aria-controls targets its own field (${controls} vs ${pwId})`)

// A reveal button inside a form must not submit it.
check(
  (await toggles.nth(0).getAttribute('type')) === 'button',
  'toggle is type=button so it cannot submit the form',
)

/* -------------------------------------- 4. the real test: no fixture venues */
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.getByLabel('Email').fill('real@bench.example')
await page.getByLabel('Password').fill('whatever')
await page.getByRole('button', { name: 'Login' }).click()
await page.waitForURL(`${BASE}/`, { timeout: 15000 })
// networkidle can resolve before the dashboard query has even been issued, so
// wait for something only the backend response can produce.
await page.getByText('Your venues').waitFor({ timeout: 15000 })

const body = await page.locator('body').innerText()

for (const ghost of ['The Rooftop, Braamfontein', 'Kota King', 'Demo Vendor', 'Daystar Hospitality']) {
  check(!body.includes(ghost), `fixture "${ghost}" is absent from the dashboard`)
}
check(body.includes('REAL BENCH VENUE'), 'the venue from the backend IS rendered')
check(
  apiCalls.some((m) => m.includes('get_vendor_dashboard')),
  'the build actually called shotright.api.get_vendor_dashboard',
)

console.log('\nAPI calls made by the production build:')
console.log('  ' + [...new Set(apiCalls)].join('\n  '))
if (consoleErrors.length) console.log('\nconsole errors:\n  ' + consoleErrors.join('\n  '))

await page.screenshot({ path: 'dashboard.png', fullPage: true })

// Signed in, so /register redirects — clear the token to get the form back.
await page.evaluate(() => sessionStorage.clear())
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' })
await page.getByLabel('Password', { exact: true }).fill('Sh0tRight!2026')
await page.getByRole('button', { name: /^show$/i }).first().click()
await page.screenshot({ path: 'register.png', fullPage: true })

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

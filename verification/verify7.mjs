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
const field = (page, name) =>
  name === 'Address'
    ? page.getByRole('combobox', { name, exact: true })
    : page.getByRole('textbox', { name, exact: true })

const submissions = []

async function wizard() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1 })
  })
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    if (u.pathname.startsWith('/api/resource/Mood'))
      return r.fulfill({ json: { data: [{ name: 'M1', mood_name: 'Chilled Bar' }] } })
    if (u.pathname.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (u.pathname.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [] } } })
    if (u.pathname.includes('create_venue')) {
      submissions.push(JSON.parse(r.request().postData() || '{}'))
      return r.fulfill({ json: { message: { name: 'V1', venue_name: 'X' } } })
    }
    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  return { page, context }
}

/**
 * The details step is ~1650px tall, so Next sits well below the fold and a
 * plain click can land before the scroll settles. Scroll first, then click —
 * this still exercises hit-testing, so a real overlay over the button would
 * still fail the test.
 */
const next = async (page) => {
  const btn = page.getByRole('button', { name: /^Next$/i })
  await btn.scrollIntoViewIfNeeded()
  await btn.click()
}
const on = async (page, text) => (await page.locator('main').innerText()).includes(text)

/* ============ step 1 gates before you can leave it ============ */
{
  const { page, context } = await wizard()

  check(await on(page, 'Chisa!'), 'starts on the mood step')
  await next(page)
  await page.waitForTimeout(400)

  check(await on(page, 'Chisa!'), 'Next is blocked with no moods — you do not leave step 1')
  check(
    await on(page, 'Add at least one mood'),
    'and the reason is stated on the step, not saved for submit',
  )

  await field(page, 'Mood').fill('Chilled Bar')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.waitForTimeout(600)
  check(
    !(await on(page, 'Add at least one mood')),
    'the banner clears the moment it is fixed — it does not outlive the block',
  )

  await next(page)
  await page.getByText("Enter your venue's details").waitFor({ timeout: 10000 })
  check(true, 'and then Next works')
  await context.close()
}

/* ============ step 2: inline, on blur, not on keystroke ============ */
{
  const { page, context } = await wizard()
  await field(page, 'Mood').fill('Chilled Bar')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.waitForTimeout(500)
  await next(page)
  await page.getByText("Enter your venue's details").waitFor({ timeout: 10000 })
  await page.waitForTimeout(400)

  // Arriving on a step must not paint every empty required field red.
  check(
    !(await on(page, 'Your venue needs a name')),
    'arriving on a step does not accuse you of everything you have not done yet',
  )

  // Typing a bad phone number must not scold mid-entry.
  const phone = field(page, 'Contact number')
  await phone.click()
  await phone.type('072')
  check(
    !(await on(page, 'does not look like a phone number')),
    'a half-typed phone number is not flagged while you are still typing it',
  )

  // ...but it is flagged on blur.
  await field(page, 'Manager name').click()
  await page.waitForTimeout(300)
  check(
    await on(page, 'does not look like a phone number'),
    'it IS flagged on blur, when you have finished with the field',
  )
  check(
    (await phone.getAttribute('aria-invalid')) === 'true',
    'and marked aria-invalid, so a screen reader knows',
  )
  const describedBy = await phone.getAttribute('aria-describedby')
  const msg = describedBy
    ? await page.locator(`[id="${describedBy.split(' ').pop()}"]`).innerText()
    : ''
  check(/phone number/.test(msg), `the reason is announced, not just coloured ("${msg.trim()}")`)

  // Fixing it clears the error without leaving the field.
  await phone.fill('0721234567')
  await page.waitForTimeout(300)
  check(
    !(await on(page, 'does not look like a phone number')),
    'fixing it clears the error immediately — no second blur needed',
  )
  await context.close()
}

/* ============ step 2: Next reveals everything outstanding at once ============ */
{
  const { page, context } = await wizard()
  await field(page, 'Mood').fill('Chilled Bar')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.waitForTimeout(500)
  await next(page)
  await page.getByText("Enter your venue's details").waitFor({ timeout: 10000 })
  await page.waitForTimeout(300)

  await next(page)
  await page.waitForTimeout(600)

  check(await on(page, "Enter your venue's details"), 'Next is blocked on the details step')
  check(await on(page, 'Your venue needs a name'), 'the missing venue name is shown inline')
  check(
    await on(page, 'Set your location'),
    'AND the missing location is shown at the same time, not one at a time',
  )

  check(
    await field(page, 'Venue name').evaluate((n) => n === document.activeElement),
    'focus moves to the FIRST problem in DOM order, not a random key',
  )

  // Location is required now, not a post-hoc warning on the success screen.
  await field(page, 'Venue name').fill('The Rooftop')
  await page.waitForTimeout(300)
  await next(page)
  await page.waitForTimeout(600)
  check(
    await on(page, "Enter your venue's details"),
    'a venue with no coordinates still cannot proceed — it would be invisible',
  )

  await field(page, 'Latitude').fill('-26.2041')
  await field(page, 'Longitude').fill('28.0473')
  await page.waitForTimeout(300)
  await next(page)
  await page.getByText('Enter your operating hours').waitFor({ timeout: 10000 })
  check(true, 'with a location it proceeds')
  await context.close()
}

/* ============ step 3: hours ============ */
{
  const { page, context } = await wizard()
  await field(page, 'Mood').fill('Chilled Bar')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.waitForTimeout(500)
  await next(page)
  await field(page, 'Venue name').fill('The Rooftop')
  await field(page, 'Latitude').fill('-26.2041')
  await field(page, 'Longitude').fill('28.0473')
  await next(page)
  await page.getByText('Enter your operating hours').waitFor({ timeout: 10000 })

  // Unselect every day.
  for (const d of ['SUN', 'MON', 'TUES', 'WED', 'THUR', 'FRI', 'SAT']) {
    const chip = page.getByRole('button', { name: d, exact: true })
    if (await chip.count()) {
      const pressed = await chip.getAttribute('aria-pressed')
      if (pressed === 'true') await chip.click()
    }
  }
  await next(page)
  await page.waitForTimeout(500)
  check(
    await on(page, 'Pick at least one day'),
    'hours with no open day are refused — that describes a venue that never opens',
  )

  await page.getByRole('button', { name: 'MON', exact: true }).click()
  await page.waitForTimeout(300)

  // Closing before opening.
  await page.getByLabel('Week day hours end time').fill('06:00')
  await next(page)
  await page.waitForTimeout(500)
  check(
    await on(page, 'closing time must be after'),
    'a closing time before the opening time is refused',
  )
  await context.close()
}

/* ============ the whole point: submit is never where you find out ============ */
{
  const { page, context } = await wizard()
  await field(page, 'Mood').fill('Chilled Bar')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.waitForTimeout(500)
  await next(page)
  await field(page, 'Venue name').fill('The Rooftop')
  await field(page, 'Latitude').fill('-26.2041')
  await field(page, 'Longitude').fill('28.0473')
  await next(page)
  await page.getByText('Enter your operating hours').waitFor({ timeout: 10000 })
  await next(page)
  await page.getByText('Enter your menu').waitFor({ timeout: 10000 })
  await next(page)
  await page.getByRole('heading', { name: /Almost done/ }).waitFor({ timeout: 10000 })

  const submit = page.getByRole('button', { name: /^Submit$/i })
  await submit.scrollIntoViewIfNeeded()
  await submit.click()
  await page.waitForTimeout(1500)

  check(submissions.length === 1, `the venue submitted (${submissions.length} call)`)
  check(
    !(await on(page, 'add one on')),
    'and no "go back three steps and fix it" message was ever needed',
  )
  await context.close()
}

/* ============ step rail: back is free, forward is gated ============ */
{
  const { page, context } = await wizard()
  await field(page, 'Mood').fill('Chilled Bar')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.waitForTimeout(500)
  await next(page)
  await page.getByText("Enter your venue's details").waitFor({ timeout: 10000 })

  await page.getByRole('button', { name: 'Setup Mood' }).click()
  await page.waitForTimeout(400)
  check(
    await on(page, 'Chisa!'),
    'the rail always lets you go BACK — never blocked by the thing you are going back to fix',
  )
  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

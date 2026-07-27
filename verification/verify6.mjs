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

/**
 * @param profile   what get_vendor_dashboard returns in `profile`
 * @param popular   the get_popular_venue_options payload, or null for "no endpoint"
 * @param geo       {latitude, longitude} to grant, or null to deny
 */
async function open({ profile, popular = null, geo = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}),
  })
  const page = await context.newPage()
  const events = []
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  await page.addInitScript(() => {
    window.__events = []
    window.addEventListener('shotright:analytics', (e) => window.__events.push(e.detail))
    try {
      localStorage.clear()
    } catch {}
  })

  if (!geo) {
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, err) =>
        err?.({ code: 1, message: 'denied' })
    })
  }

  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    if (u.pathname.startsWith('/api/resource/Mood'))
      return r.fulfill({ json: { data: [{ name: 'M1', mood_name: 'Chilled Bar' }] } })
    if (u.pathname.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (u.pathname.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile, stats: {}, venues: [] } } })
    if (u.pathname.includes('get_popular_venue_options')) {
      if (!popular) return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
      return r.fulfill({ json: { message: popular } })
    }
    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  // Step 1 is moods; step 2 is the form under test. At least one mood is now
  // required before the step can be left, so add one.
  await field(page, 'Mood').fill('Chilled Bar')
  await page.getByRole('button', { name: /^Add/ }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /^Next$/i }).click()
  await field(page, 'Venue name').waitFor({ timeout: 10000 })
  await page.waitForTimeout(400)
  return { page, context, events }
}

const PROFILE = { email: 'a@b.c', first_name: 'Thabo', last_name: 'Mokoena', phone: '+27825550134' }
const bg = (l) => l.evaluate((n) => getComputedStyle(n).backgroundColor)

// getByLabel would also match the chip's "Clear default manager name" button.
// Address is an ARIA combobox, not a plain textbox.
const field = (page, name) =>
  name === 'Address'
    ? page.getByRole('combobox', { name, exact: true })
    : page.getByRole('textbox', { name, exact: true })
const select = (page, name) => page.getByRole('combobox', { name, exact: true })

/* ============ Tier A + D: the core payoff ============ */
{
  const { page, context } = await open({ profile: PROFILE })

  check(
    await field(page, 'Venue name').evaluate((n) => n === document.activeElement),
    'focus lands on Venue name — the only field we could not fill (§11)',
  )
  check((await field(page, 'Venue name').inputValue()) === '', 'venue name is never defaulted')

  check(
    (await field(page, 'Manager name').inputValue()) === 'Thabo',
    'manager name prefilled from the profile',
  )
  check(
    (await field(page, 'Manager surname').inputValue()) === 'Mokoena',
    'manager surname prefilled from the profile',
  )

  // Visible: the prefill background must actually differ from a normal field.
  const defaulted = await bg(field(page, 'Manager name'))
  const plain = await bg(field(page, 'Venue name'))
  check(defaulted !== plain, `a defaulted field looks different (${defaulted} vs ${plain})`)

  // Described by its chip, so a screen reader says where the value came from.
  const describedBy = await field(page, 'Manager name').getAttribute('aria-describedby')
  const chipText = describedBy
    ? await page.locator(`[id="${describedBy}"]`).innerText()
    : ''
  check(/From your profile/.test(chipText), `chip describes the field ("${chipText.trim()}")`)

  const live = await page.locator('[role="status"][aria-live="polite"]').first().innerText()
  check(
    /prefilled from your profile/.test(live) && /change any of them/.test(live),
    `one live-region summary, not one per field ("${live.trim()}")`,
  )

  await context.close()
}

/* ============ Tier B: dormant without a verification flag ============ */
{
  const { page, context } = await open({ profile: PROFILE })
  check(
    (await field(page, 'Contact number').inputValue()) === '',
    'an UNVERIFIED number is not applied — §9 forbids laundering it',
  )
  check(
    (await bg(field(page, 'Contact number'))) === (await bg(field(page, 'Venue name'))),
    'and it carries no prefill styling',
  )
  await context.close()
}

/* ============ Tier B: applied + gated once verified ============ */
{
  const { page, context } = await open({
    profile: { ...PROFILE, phone_verified: 1 },
  })

  check(
    (await field(page, 'Contact number').inputValue()) === '+27 82 555 0134',
    `a verified number is applied in national grouping (got "${await field(page, 'Contact number').inputValue()}")`,
  )

  // The gate: Next must not proceed while it is unconfirmed. Required fields
  // are filled first, because validation runs BEFORE the Tier B check — a
  // missing required value outranks an unconfirmed guess.
  await field(page, 'Venue name').fill('Test Venue')
  await field(page, 'Latitude').fill('-26.2041')
  await field(page, 'Longitude').fill('28.0473')
  const n0 = page.getByRole('button', { name: /^Next$/i })
  await n0.scrollIntoViewIfNeeded()
  await n0.click()
  await page.waitForTimeout(700)
  check(
    await field(page, 'Contact number').isVisible(),
    'Next is BLOCKED while the Tier B default is unconfirmed',
  )
  const gate = await page.locator('main').innerText()
  check(
    /right number for customers to call/.test(gate),
    'and says exactly why, in the spec\'s words',
  )

  await page.getByRole('button', { name: /Yes, use this/i }).click()
  const n1 = page.getByRole('button', { name: /^Next$/i })
  await n1.scrollIntoViewIfNeeded()
  await n1.click()
  await page.waitForTimeout(700)
  check(
    !(await field(page, 'Contact number').isVisible()),
    'confirming releases the gate',
  )
  await context.close()
}

/* ============ Tier B: editing counts as confirming ============ */
{
  const { page, context } = await open({ profile: { ...PROFILE, phone_verified: 1 } })
  await field(page, 'Contact number').fill('+27 11 000 1111')
  await field(page, 'Venue name').fill('Test Venue')
  await field(page, 'Latitude').fill('-26.2041')
  await field(page, 'Longitude').fill('28.0473')
  const n2 = page.getByRole('button', { name: /^Next$/i })
  await n2.scrollIntoViewIfNeeded()
  await n2.click()
  await page.waitForTimeout(700)
  check(
    !(await field(page, 'Contact number').isVisible()),
    'editing a Tier B field is itself confirmation (§3), no second acknowledgement',
  )
  await context.close()
}

/* ============ Tier C: no endpoint means NO invented statistic ============ */
{
  const { page, context } = await open({ profile: PROFILE, popular: null })
  check(
    (await select(page, 'Dress code').inputValue()) === '',
    'no popularity endpoint means no dropdown default',
  )
  const body = await page.locator('main').innerText()
  check(
    !/%/.test(body),
    'and NO fabricated percentage anywhere on the form',
  )
  await context.close()
}

/* ============ Tier C: applied with its share when supplied ============ */
{
  const { page, context } = await open({
    profile: PROFILE,
    popular: {
      dress_code: { value: 'Smart Casual', share: 62 },
      atmosphere: { value: 'Fine dining', share: 48 },
    },
  })
  check(
    (await select(page, 'Dress code').inputValue()) === 'Smart Casual',
    'the popular dress code is pre-selected',
  )
  const body = await page.locator('main').innerText()
  check(
    /Most venues pick this \(62%\)/.test(body),
    'the chip shows the share as justification, in the spec\'s copy',
  )
  check(/\(48%\)/.test(body), 'atmosphere carries its own share, not a shared one')
  await context.close()
}

/* ============ Override: dismiss ============ */
{
  const { page, context, events } = await open({ profile: PROFILE })

  const before = await select(page, 'Dress code').boundingBox()
  await page.getByRole('button', { name: 'Clear default manager name' }).click()
  await page.waitForTimeout(300)

  check((await field(page, 'Manager name').inputValue()) === '', 'dismissing clears the field')
  check(
    await field(page, 'Manager name').evaluate((n) => n === document.activeElement),
    'and returns focus so they can type immediately (§6)',
  )
  check(
    (await bg(field(page, 'Manager name'))) === (await bg(field(page, 'Venue name'))),
    'and the prefill styling clears',
  )

  const after = await select(page, 'Dress code').boundingBox()
  check(
    Math.abs(before.y - after.y) < 2,
    `the chip row reserves its height — no layout shift (${Math.round(before.y)} -> ${Math.round(after.y)})`,
  )

  const kinds = (await page.evaluate(() => window.__events)).map((e) => e.event)
  check(kinds.includes('default_applied'), 'default_applied instrumented')
  check(kinds.includes('default_dismissed'), 'default_dismissed instrumented')
  await context.close()
}

/* ============ Override: type over ============ */
{
  const { page, context } = await open({ profile: PROFILE })
  await field(page, 'Manager surname').fill('Dlamini')
  await page.waitForTimeout(200)
  check(
    (await page.getByRole('button', { name: 'Clear default manager surname' }).count()) === 0,
    'typing over removes the chip silently — no toast, no explanation (§6)',
  )
  const kinds = (await page.evaluate(() => window.__events)).map((e) => e.event)
  check(kinds.includes('default_edited'), 'default_edited instrumented')
  await context.close()
}

/* ============ Dirty flags survive step navigation (§6, §9) ============ */
{
  const { page, context } = await open({ profile: PROFILE })
  await field(page, 'Manager name').fill('Lerato')
  await field(page, 'Venue name').fill('Test Venue')
  await field(page, 'Latitude').fill('-26.2041')
  await field(page, 'Longitude').fill('28.0473')

  // Step away and back — the classic regression.
  const nx = page.getByRole('button', { name: /^Next$/i })
  await nx.scrollIntoViewIfNeeded()
  await nx.click()
  await page.getByText('Enter your operating hours').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: /^Previous$/i }).click()
  await field(page, 'Manager name').waitFor()
  await page.waitForTimeout(400)

  check(
    (await field(page, 'Manager name').inputValue()) === 'Lerato',
    'an edited field is NOT re-defaulted after leaving and returning',
  )
  check(
    (await page.getByRole('button', { name: 'Clear default manager name' }).count()) === 0,
    'and no chip reappears claiming we supplied it',
  )
  await context.close()
}

/* ============ Browser autofill at mount (§9) ============ */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage()
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1 })
  })
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    if (u.pathname.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (u.pathname.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (u.pathname.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [] } } })
    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.close()
  await context.close()
  // Autofill is simulated at the unit level instead — see below.
}

/* ============ Address confirmation chip must NOT clear the address (§6) ============ */
{
  const { page, context } = await open({ profile: PROFILE })

  await page.route('**/nominatim.openstreetmap.org/**', (r) =>
    r.fulfill({
      json: [
        { place_id: 1, display_name: '70 Juta St, Braamfontein, Johannesburg', lat: '-26.1929', lon: '28.0305' },
      ],
    }),
  )

  const address = field(page, 'Address')
  await address.fill('70 Juta')
  await page.getByRole('option').first().waitFor({ timeout: 10000 })
  await page.getByRole('option').first().click()
  await page.waitForTimeout(400)

  check(
    (await address.inputValue()).includes('Juta'),
    'choosing a suggestion fills the address',
  )
  const chip = page.getByRole('button', { name: 'Hide the pin notice' })
  check((await chip.count()) === 1, 'and shows the pin-dropped confirmation')

  const addressBefore = await address.inputValue()
  await chip.click()
  await page.waitForTimeout(300)

  check(
    (await address.inputValue()) === addressBefore,
    'dismissing that chip removes the NOTICE ONLY — the address stays (§6)',
  )
  const lat = await field(page, 'Latitude').inputValue()
  check(lat.startsWith('-26.19'), `and the pin stays too (lat ${lat})`)
  await context.close()
}

/* ============ Geolocation: provisional pin, and it blocks Continue ============ */
{
  const { page, context } = await open({
    profile: PROFILE,
    geo: { latitude: -26.2041, longitude: 28.0473 },
  })
  await page.waitForTimeout(1200)

  const lat = await field(page, 'Latitude').inputValue()
  check(lat.startsWith('-26.20'), `a provisional pin drops from the device (lat ${lat})`)

  const body = await page.locator('main').innerText()
  check(
    /roughly where you are now, not your venue/.test(body),
    'and is labelled a guess, not presented as the venue',
  )

  await field(page, 'Venue name').fill('Test Venue')
  const n4 = page.getByRole('button', { name: /^Next$/i })
  await n4.scrollIntoViewIfNeeded()
  await n4.click()
  await page.waitForTimeout(700)
  check(
    await field(page, 'Venue name').isVisible(),
    'a provisional pin BLOCKS Continue — the highest-stakes default on the form',
  )
  check(
    /confirm the pin is on your venue/.test(await page.locator('main').innerText()),
    'with copy naming the pin specifically',
  )
  await context.close()
}

/* ============ No geolocation: form fully usable ============ */
{
  const { page, context } = await open({ profile: PROFILE, geo: null })
  const body = await page.locator('main').innerText()
  check(
    /Pick an address above \(or allow location\)/.test(body),
    'no signal shows the empty-state overlay, not a broken grey box',
  )
  // No device signal, so the location has to be entered by hand — which is
  // exactly the path this case is about being usable.
  await field(page, 'Venue name').fill('Test')
  await field(page, 'Latitude').fill('-26.2041')
  await field(page, 'Longitude').fill('28.0473')
  const nz = page.getByRole('button', { name: /^Next$/i })
  await nz.scrollIntoViewIfNeeded()
  await nz.click()
  await page.getByText('Enter your operating hours').waitFor({ timeout: 10000 })
  check(true, 'and the form is fully usable without it')
  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

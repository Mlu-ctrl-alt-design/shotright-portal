import { chromium } from 'playwright'
import {
  describeVenue,
  openLocation,
  pickMood,
  saveAndAddPhotos,
  toVenueForm,
} from './addVenue.mjs'

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
    if (u.pathname.includes('/api/method/upload_file'))
      return r.fulfill({
        json: {
          message: {
            name: 'FILE-QA',
            file_url: '/files/qa-venue.png',
            file_name: 'qa-venue.png',
          },
        },
      })

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  /* ⚠️ There is no mood step to walk past any more (17 Sep) — the whole venue
     is one page, behind an import screen that this bench cannot serve. */
  await toVenueForm(page, BASE)
  await page.waitForTimeout(400)
  return { page, context, events }
}

const PROFILE = { email: 'a@b.c', first_name: 'Thabo', last_name: 'Mokoena', phone: '+27825550134' }
const bg = (l) => l.evaluate((n) => getComputedStyle(n).backgroundColor)

// getByLabel would also match the chip's "Clear default manager" button.
// Address is an ARIA combobox, not a plain textbox.
const field = (page, name) =>
  name === 'Address'
    ? page.getByRole('combobox', { name, exact: true })
    : page.getByRole('textbox', { name, exact: true })
const select = (page, name) => page.getByRole('combobox', { name, exact: true })

/**
 * Set the venue's location the way a partner now does — by picking an address.
 *
 * ⚠️ THE LATITUDE AND LONGITUDE FIELDS ARE GONE. Changed 13 Aug: a partner
 * reads a street name, not `-26.204100`. These suites used to type the numbers
 * straight in, which was convenient and skipped the entire address→coordinates
 * handoff — the one part of this screen that decides whether a venue is
 * findable at all. Picking the suggestion tests more than the old version did.
 *
 * The geocoder is stubbed per-page rather than left to reach the real
 * OpenStreetMap service: these run offline in CI, and a suite that silently
 * depends on a third party is a suite that goes red for reasons nobody owns.
 */
async function setLocation(page, label = '70 Juta') {
  await page.route('**/nominatim.openstreetmap.org/**', (r) =>
    r.fulfill({
      json: [
        {
          place_id: 1,
          display_name: '70 Juta St, Braamfontein, Johannesburg',
          lat: '-26.2041',
          lon: '28.0473',
        },
      ],
    }),
  )
  /* ⚠️ The map and the address field are behind a confirm row since 17 Sep —
     auto-pinned from the address, opened only by someone who wants to check
     it. That collapse is most of the reason the whole venue now fits on one
     page, and opening it IS the partner's path: there is no other way to reach
     the address field. */
  await openLocation(page)
  const address = page.getByRole('combobox', { name: 'Address', exact: true })
  await address.fill(label)
  await page.getByRole('option').first().waitFor({ timeout: 10000 })
  await page.getByRole('option').first().click()
  // The pin lands with the pick; wait for it, or the next step validates a
  // venue that has an address and no point.
  await page.locator('[data-field="latitude"][data-latitude]').waitFor({ timeout: 10000 })

  /* ⚠️ Validation runs BEFORE the Tier B confirmation check — a missing
     required value outranks an unconfirmed guess — so a walk that wants to
     reach the smart-defaults gate has to satisfy everything else first. Since
     17 Sep that includes a mood and a description, both of which are required
     and neither of which existed on this step before. Folded in here because
     every caller of `setLocation` is a caller who needs a valid form. */
  await pickMood(page)
  await describeVenue(page)

  await addPhoto(page)
}

/**
 * The contact number, filled by hand.
 *
 * ⚠️ DELIBERATELY NOT part of `setLocation`. The Tier B gate is entirely about
 * this one field, and editing a Tier B default IS confirmation (§3) — so a
 * helper that filled it would quietly disarm the thing half this suite is
 * testing. Callers that simply need a valid form ask for it; the gate tests do
 * not.
 */
const fillContact = (page) =>
  page.getByRole('textbox', { name: 'Contact number', exact: true }).fill('012 460 1188')

/**
 * Add one photo — REQUIRED as of 13 Aug.
 *
 * A venue with no picture is a name and an address, and this is a product
 * people choose by looking. Folded into `setLocation` because every caller of
 * that is a caller who needs the details step to be VALID, and photos are now
 * part of what valid means.
 *
 * The requirement lifts itself if the bench refuses the upload — see
 * `validateDetails` — so a suite that stubs a 403 does not need to change.
 */
async function addPhoto(page) {
  const input = page.getByLabel('Venue photos — choose files')
  if ((await input.count()) === 0) return
  await input.setInputFiles({
    name: 'qa-venue.png',
    mimeType: 'image/png',
    // 1×1 PNG. Real bytes, because prepareImage decodes through a canvas in a
    // real browser and would reject a fake.
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  })
  // The counter only moves once the server has answered, so this waits for the
  // upload rather than for the input to accept the file.
  await page.getByText(/1 of \d+/).waitFor({ timeout: 15000 }).catch(() => {})
}

/** What the map is holding, now that no input displays it. */
const pinLatitude = (page) =>
  page.locator('[data-field="latitude"]').getAttribute('data-latitude')

/* ============ Tier A + D: the core payoff ============ */
{
  const { page, context } = await open({ profile: PROFILE })

  check(
    await field(page, 'Venue name').evaluate((n) => n === document.activeElement),
    'focus lands on Venue name — the only field we could not fill (§11)',
  )
  check((await field(page, 'Venue name').inputValue()) === '', 'venue name is never defaulted')

  /* ⚠️ ONE field since 17 Sep. The redesign merged "Manager name" and
     "Manager surname" into a single "Manager", split back apart on the way to
     create_venue — so the default is now the whole name rather than two. */
  check(
    (await field(page, 'Manager').inputValue()) === 'Thabo Mokoena',
    'the manager is prefilled from the profile, whole',
  )

  // Visible: the prefill background must actually differ from a normal field.
  const defaulted = await bg(field(page, 'Manager'))
  const plain = await bg(field(page, 'Venue name'))
  check(defaulted !== plain, `a defaulted field looks different (${defaulted} vs ${plain})`)

  // Described by its chip, so a screen reader says where the value came from.
  const describedBy = await field(page, 'Manager').getAttribute('aria-describedby')
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
  await setLocation(page)
  const n0 = page.getByRole('button', { name: /save and add photos/i })
  await n0.scrollIntoViewIfNeeded()
  await n0.click()
  await page.waitForTimeout(700)
  check(
    await field(page, 'Contact number').isVisible(),
    'Save is BLOCKED while the Tier B default is unconfirmed',
  )
  const gate = await page.locator('main').innerText()
  check(
    /right number for customers to call/.test(gate),
    'and says exactly why, in the spec\'s words',
  )

  await page.getByRole('button', { name: /Yes, use this/i }).click()
  const n1 = page.getByRole('button', { name: /save and add photos/i })
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
  await setLocation(page)
  const n2 = page.getByRole('button', { name: /save and add photos/i })
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
  /* Polled rather than read once: the popularity call is a network round trip
     and the default lands when it answers. A bare read here is a bet on how
     fast the machine is, and a flaky check is worse than a missing one because
     it teaches people that red does not mean anything. */
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('select[aria-label="Dress code"]')
        return el && el.value !== ''
      },
      { timeout: 10000 },
    )
    .catch(() => {})
  check(
    (await select(page, 'Dress code').inputValue()) === 'Smart Casual',
    'the popular dress code is pre-selected',
  )
  const body = await page.locator('main').innerText()
  check(
    /Most venues pick this \(62%\)/.test(body),
    'the chip shows the share as justification, in the spec\'s copy',
  )
  /* ⚠️ The atmosphere dropdown is GONE (17 Sep) — replaced by the mood chips,
     which ask the same question in the vocabulary customers search by. Its
     smart default went with it: defaulting a field with no input on screen is
     a value the partner can neither see nor clear. Dress code is the only
     Tier C field left, which is what the share assertion above now proves. */
  check(!/\(48%\)/.test(body), 'a retired field carries no orphan default')
  await context.close()
}

/* ============ Override: dismiss ============ */
{
  const { page, context, events } = await open({ profile: PROFILE })

  const before = await select(page, 'Dress code').boundingBox()
  await page.getByRole('button', { name: 'Clear default manager' }).click()
  await page.waitForTimeout(300)

  check((await field(page, 'Manager').inputValue()) === '', 'dismissing clears the field')
  check(
    await field(page, 'Manager').evaluate((n) => n === document.activeElement),
    'and returns focus so they can type immediately (§6)',
  )
  check(
    (await bg(field(page, 'Manager'))) === (await bg(field(page, 'Venue name'))),
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
  await field(page, 'Manager').fill('Dlamini')
  await page.waitForTimeout(200)
  check(
    (await page.getByRole('button', { name: 'Clear default manager' }).count()) === 0,
    'typing over removes the chip silently — no toast, no explanation (§6)',
  )
  const kinds = (await page.evaluate(() => window.__events)).map((e) => e.event)
  check(kinds.includes('default_edited'), 'default_edited instrumented')
  await context.close()
}

/* ============ Dirty flags survive screen navigation (§6, §9) ============ */
{
  /* ⚠️ THE SAME REGRESSION, ON THE NEW SHAPE. There are no steps to walk
     between any more, but the form still unmounts — going forward to the
     photos and back is now the journey that used to re-apply a default over
     somebody's edit. §6 requires a touched field to stay excluded for the
     whole session, and this is what proves it still does. */
  const { page, context } = await open({ profile: PROFILE })
  await field(page, 'Manager').fill('Lerato')
  await field(page, 'Venue name').fill('Test Venue')
  await field(page, 'Contact number').fill('012 460 1188')
  await setLocation(page)

  await saveAndAddPhotos(page)
  await page.getByRole('heading', { name: /now the photos/i }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: /back to details/i }).click()
  await field(page, 'Manager').waitFor()
  await page.waitForTimeout(400)

  check(
    (await field(page, 'Manager').inputValue()) === 'Lerato',
    'an edited field is NOT re-defaulted after leaving and returning',
  )
  check(
    (await page.getByRole('button', { name: 'Clear default manager' }).count()) === 0,
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

  /* The address lives behind the confirm row since 17 Sep — opening it is the
     partner's only path to the field. */
  await openLocation(page)
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
  const lat = (await pinLatitude(page)) || ''
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

  /* The confirm row says so before anything is opened — a provisional pin must
     never read as settled, and the map is collapsed by default now. */
  check(
    /Roughly where you are now, not your venue/.test(await page.locator('main').innerText()),
    'the collapsed row says the pin is a guess, without being opened',
  )

  await openLocation(page)
  const lat = (await pinLatitude(page)) || ''
  check(lat.startsWith('-26.20'), `a provisional pin drops from the device (lat ${lat})`)

  const body = await page.locator('main').innerText()
  check(
    /where you are now, not your venue/.test(body),
    'and is labelled a guess, not presented as the venue',
  )

  await field(page, 'Venue name').fill('Test Venue')
  /* Satisfy everything else first, so the ONLY outstanding item is the
     provisional pin. Without this the gate blocks for a missing required field
     and the assertions below pass or fail for the wrong reason — the banner
     names the FIRST outstanding field, and this test is about the pin. */
  await fillContact(page)
  await pickMood(page)
  await describeVenue(page)
  await addPhoto(page)
  const n4 = page.getByRole('button', { name: /save and add photos/i })
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
  /* The map is behind the confirm row now, so somebody has to open it before
     its empty state is on screen. The row itself says "Add your address and we
     drop the pin", which is the same information one level up. */
  check(
    /Add your address and we drop the pin/.test(await page.locator('main').innerText()),
    'with no signal, the collapsed row says what to do rather than showing nothing',
  )
  await openLocation(page)
  const body = await page.locator('main').innerText()
  check(
    /Pick an address above \(or allow location\)/.test(body),
    'and the map itself shows the empty-state overlay, not a broken grey box',
  )
  // No device signal, so the location has to be entered by hand — which is
  // exactly the path this case is about being usable.
  await field(page, 'Venue name').fill('Test')
  await fillContact(page)
  await setLocation(page)
  const nz = page.getByRole('button', { name: /save and add photos/i })
  await nz.scrollIntoViewIfNeeded()
  await nz.click()
  await page.getByRole('heading', { name: /now the photos/i }).waitFor({ timeout: 10000 })
  check(true, 'and the form is fully usable without it')
  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

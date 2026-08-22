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

/**
 * `draftEndpoints: false` is TODAY — the four draft methods 404, so the portal
 * must fall back to localStorage and must NOT print the email promise.
 * `true` simulates them being deployed.
 */
async function open({ draftEndpoints = false, store = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname
    if (p.startsWith('/api/resource/Mood'))
      return r.fulfill({ json: { data: [{ name: 'M1', mood_name: 'Chilled Bar' }] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [] } } })

    if (draftEndpoints) {
      if (p.includes('list_venue_drafts'))
        return r.fulfill({ json: { message: Object.values(store) } })
      if (p.includes('get_venue_draft')) {
        const id = u.searchParams.get('draft_id')
        return store[id]
          ? r.fulfill({ json: { message: store[id] } })
          : r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
      }
      if (p.includes('save_venue_draft')) {
        const body = JSON.parse(r.request().postData() || '{}')
        const id = body.draft_id || 'VD-1'
        store[id] = {
          draft_id: id,
          step: body.step,
          completed: JSON.parse(body.completed || '[]'),
          venue_name: body.venue_name,
          payload: JSON.parse(body.payload || '{}'),
          modified: new Date().toISOString(),
        }
        return r.fulfill({ json: { message: store[id] } })
      }
      if (p.includes('discard_venue_draft')) return r.fulfill({ json: { message: { ok: true } } })
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
  return { page, context }
}

const card = (page) => page.getByRole('region', { name: 'Pick up where you left off' })

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
  const address = page.getByRole('combobox', { name: 'Address', exact: true })
  await address.fill(label)
  await page.getByRole('option').first().waitFor({ timeout: 10000 })
  await page.getByRole('option').first().click()
  // The pin lands with the pick; wait for it, or the next step validates a
  // venue that has an address and no point.
  await page.locator('[data-field="latitude"][data-latitude]').waitFor({ timeout: 10000 })

  await addPhoto(page)
}

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

/* ============================================================================
   1. AUTOSAVE + RESUME, on the local fallback (today's world)
   ========================================================================= */
{
  const { page, context } = await open()

  check(!(await card(page).isVisible()), 'no resume card before anything has been started')

  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  // Step 1 — a mood.
  await page.getByRole('textbox', { name: 'Mood', exact: true }).fill('Chilled Bar')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Next' }).click()

  // Step 2 — the venue name, which is what the card must name back to us.
  await page.getByLabel(/venue name/i).fill('Corner Kitchen & Bar')
  await page.waitForTimeout(1800) // past the 1.2s autosave debounce

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('shotright.venueDrafts') || '{}'),
  )
  const draft = Object.values(saved)[0]
  check(Boolean(draft), 'the wizard autosaved a draft without being asked')
  check(draft?.venue_name === 'Corner Kitchen & Bar', 'the draft carries the venue name')
  check(draft?.step === 'details', 'the draft records which step they were on')
  check(
    JSON.stringify(draft?.completed) === JSON.stringify(['mood']),
    'and which steps are already finished',
  )
  check(
    draft?.payload?.moods?.moods?.length === 1,
    'the mood chosen on step 1 survived into the payload',
  )

  /* Walk away, exactly as a partner would. */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  check(await card(page).isVisible(), 'the dashboard offers to pick up where they left off')

  const text = (await card(page).innerText()).replace(/\n/g, ' ')
  check(/Corner Kitchen & Bar/.test(text), 'the card names the venue')
  check(/step 2 of 5, Venue details/.test(text), 'the card names the exact step')
  check(/Saved (just now|\d+ minute)/i.test(text), 'the card says when it was saved')

  /* THE PROMISE, on a local draft: must NOT claim an email was sent. */
  check(
    !/emailed you/i.test(text),
    'a browser-only draft does not claim we emailed them a link (nothing sent it)',
  )
  check(/Saved in this browser/i.test(text), 'it says where the draft actually lives instead')

  /* Continue. */
  await card(page).getByRole('link', { name: 'Continue setup' }).click()
  await page.waitForURL(/\/venues\/new\?draft=/)
  await page.waitForTimeout(600)
  check(
    await page.getByLabel(/venue name/i).inputValue().then((v) => v === 'Corner Kitchen & Bar'),
    'resuming restores the work, on the step they left it on',
  )
  check(
    await page.getByRole('heading', { name: /venue's details/i }).isVisible(),
    'and lands on step 2, not back at step 1',
  )

  await context.close()
}

/* ============================================================================
   2. THE SAME CARD once the backend endpoints exist
   ========================================================================= */
{
  const store = {
    'VD-9': {
      draft_id: 'VD-9',
      step: 'menu',
      completed: ['mood', 'details', 'hours'],
      venue_name: 'Corner Kitchen & Bar',
      payload: { details: { venue_name: 'Corner Kitchen & Bar' } },
      modified: new Date(Date.now() - 2 * 86400_000).toISOString(),
    },
  }
  const { page, context } = await open({ draftEndpoints: true, store })
  await page.waitForTimeout(400)

  const text = (await card(page).innerText()).replace(/\n/g, ' ')
  check(/step 4 of 5, Menu options/.test(text), 'a server draft resumes at the right step')
  check(/Saved 2 days ago/.test(text), 'relative time is rounded down, not up')
  check(
    /emailed you this link/i.test(text),
    'with a real server draft the card DOES make the email promise',
  )
  // textContent, not innerText: the state words are sr-only, which is the point.
  const raw = await card(page).evaluate((n) => n.textContent)
  check(/Setup mood — done/.test(raw), 'step state is spelled out, not carried by colour alone')
  check(/Menu options — where you left off/.test(raw), 'and so is the current step')

  await context.close()
}

/* ============================================================================
   3. MENU IMPORT — the four-stage checklist, on wizard step 4 of 5
   ========================================================================= */
{
  const { page, context } = await open()
  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })

  // Step 1 — a mood.
  await page.getByRole('textbox', { name: 'Mood', exact: true }).fill('Chilled Bar')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /^Next$/i }).click()
  await page.waitForTimeout(400)

  // Step 2 — name and a pin (typed, so no geolocation is involved).
  await page.getByRole('textbox', { name: 'Venue name', exact: true }).fill('Corner Kitchen & Bar')
  await setLocation(page)
  const next2 = page.getByRole('button', { name: /^Next$/i })
  await next2.scrollIntoViewIfNeeded()
  await next2.click()
  await page.waitForTimeout(400)

  // Step 3 — the default open days are already valid.
  const next3 = page.getByRole('button', { name: /^Next$/i })
  await next3.scrollIntoViewIfNeeded()
  await next3.click()
  await page.waitForTimeout(400)

  check(
    /Enter your menu/i.test(await page.locator('h1').first().innerText()),
    'reached the menu step',
  )

  // A category to import into, then the file itself.
  await page.getByRole('textbox', { name: 'Menu category' }).fill('Cocktails')
  await page.getByRole('button', { name: /^Add$/i }).click()
  await page.waitForTimeout(300)

  // 3 categories, 2,001 rows, exactly one of them priceless. Big enough that the
  // stages are genuinely observable rather than flashing past — which is also
  // the only size of file where a partner would ever read them.
  const CATS = ['Cocktails', 'Small Plates', 'Mains']
  const lines = ['heading,item_name,price,description']
  for (let i = 0; i < 2000; i += 1) lines.push(`${CATS[i % 3]},Item ${i},${50 + (i % 40)},`)
  lines.push('Mains,Beef Short Rib,,Ask your server') // deliberately priceless
  const CSV = lines.join('\n')

  // Recorded IN THE PAGE with a MutationObserver rather than polled over the
  // wire: a 2,000-row parse yields every 250 rows, so the intermediate stages
  // live for a few milliseconds each and a round-trip poll simply misses them.
  // The question this answers is "did the partner's screen ever say it", and
  // only the DOM knows that.
  await page.evaluate(() => {
    window.__seen = []
    const record = () => window.__seen.push(document.querySelector('main')?.innerText || '')
    new MutationObserver(record).observe(document.querySelector('main'), {
      subtree: true,
      childList: true,
      characterData: true,
    })
    record()
  })

  await page.setInputFiles('input[type="file"]', {
    name: 'winter-menu.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV),
  })
  await page.waitForTimeout(4000)

  const all = (await page.evaluate(() => window.__seen)).join(' | ').replace(/\n/g, ' ')
  const seenBody = all
  check(/Reading your menu file/.test(all), 'the wait says WHAT is happening, not "loading"')
  check(/Uploaded your file/.test(all), 'stage 1 of the checklist appeared')
  check(/Found 3 categories/.test(all), 'stage 2 reported the real category count from the file')
  check(/Reading 2,?001 items and prices/.test(all), 'stage 3 reported the real row count')
  check(/\d+ of 2001/.test(all), 'and a live sub-count that is measured, not animated')
  check(
    /Checking for missing prices|1 item is missing a price/.test(all),
    'stage 4 appeared and counted the priceless row',
  )
  check(
    !/Found 0 categories|Reading 0 items/.test(all),
    'no stage ever printed a count it had not yet worked out',
  )

  const body = (await page.locator('main').innerText()).replace(/\n/g, ' ')
  check(/Step 4 of 5/i.test(seenBody), 'the panel is labelled as step 4 of 5, as designed')
  check(/winter-menu\.csv/.test(body), 'the file is named back to the partner')
  check(
    !/leave this page|emailed you the moment/i.test(body),
    'the in-browser wizard parse does NOT promise "leave the page, we will email you" — it cannot keep that',
  )
  check(
    /2001 items added/.test(body),
    'and it reports what actually landed, including the priceless row',
  )
  check(
    /1 item has no price yet/.test(body),
    'the missing price is reported rather than silently becoming R 0.00',
  )

  await context.close()
}

/* ============================================================================
   4. The way out is offered from the first second, not after 45 wasted ones
   ========================================================================= */
{
  const { page, context } = await open()
  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  await page.getByRole('textbox', { name: 'Mood', exact: true }).fill('Chilled Bar')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /^Next$/i }).click()
  await page.waitForTimeout(300)
  await page.getByRole('textbox', { name: 'Venue name', exact: true }).fill('X')
  await setLocation(page)
  for (const _ of [1, 2]) {
    const n = page.getByRole('button', { name: /^Next$/i })
    await n.scrollIntoViewIfNeeded()
    await n.click()
    await page.waitForTimeout(400)
  }
  await page.getByRole('textbox', { name: 'Menu category' }).fill('Cocktails')
  await page.getByRole('button', { name: /^Add$/i }).click()
  await page.waitForTimeout(200)

  // 4000 rows, so the parse is genuinely slow enough to observe.
  const big = ['heading,item_name,price,description']
  for (let i = 0; i < 4000; i += 1) big.push(`Cocktails,Drink ${i},${50 + (i % 40)},`)

  let escapeSeen = false
  const watch = setInterval(async () => {
    try {
      if (await page.getByRole('button', { name: /Add your items by hand instead/i }).isVisible())
        escapeSeen = true
    } catch {}
  }, 25)

  await page.setInputFiles('input[type="file"]', {
    name: 'huge.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(big.join('\n')),
  })
  await page.waitForTimeout(1500)
  clearInterval(watch)

  check(escapeSeen, 'the manual-entry escape hatch is offered during the wait, not only after it')

  await context.close()
}

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed')
process.exit(fail.length ? 1 : 0)

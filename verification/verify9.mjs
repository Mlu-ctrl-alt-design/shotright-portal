import { chromium } from 'playwright'
import { pickMood, skipImport } from './addVenue.mjs'

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
    /* ⚠️ THE MENU LEFT THE WIZARD on 17 Sep — it does not hold up going live,
       and sitting in the middle of onboarding said that it did. The four-stage
       import checklist below is unchanged and still worth testing; it is just
       tested where the feature now lives, at /venues/:id/menu. These two reads
       are what that screen needs to render. */
    if (p.includes('get_venue_detail'))
      return r.fulfill({
        json: {
          message: {
            name: 'VEN-1',
            venue_name: 'Corner Kitchen & Bar',
            workflow_state: 'Approved',
            moods: [],
            operating_hours: [],
          },
        },
      })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })

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
  /* ⚠️ ONE PAGE since 17 Sep — no mood step, no Next. A mood is a chip in the
     vibe section, and the venue name is what the resume card must name back
     to us. */
  await skipImport(page)
  await pickMood(page)
  await page.getByRole('textbox', { name: 'Venue name', exact: true }).fill('Corner Kitchen & Bar')
  await page.waitForTimeout(1800) // past the 1.2s autosave debounce

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('shotright.venueDrafts') || '{}'),
  )
  const draft = Object.values(saved)[0]
  check(Boolean(draft), 'the wizard autosaved a draft without being asked')
  check(draft?.venue_name === 'Corner Kitchen & Bar', 'the draft carries the venue name')
  /* ⚠️ `step` is the first UNFINISHED section now, not the screen they were
     standing on — there is only one screen to stand on. That is a better
     answer to the dashboard's "how far did I get": it names the next thing to
     do rather than the last place they were. */
  check(draft?.step === 'basics', 'the draft records the next thing to do')
  check(
    JSON.stringify(draft?.completed) === JSON.stringify(['vibe', 'hours']),
    'and which sections are already finished',
  )
  check(
    draft?.payload?.moods?.moods?.length === 1,
    'the mood they picked survived into the payload',
  )

  /* Walk away, exactly as a partner would. */
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  check(await card(page).isVisible(), 'the dashboard offers to pick up where they left off')

  const text = (await card(page).innerText()).replace(/\n/g, ' ')
  check(/Corner Kitchen & Bar/.test(text), 'the card names the venue')
  check(/step 1 of 6, The basics/.test(text), 'the card names exactly where they are')
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
    await page
      .getByRole('textbox', { name: 'Venue name', exact: true })
      .inputValue()
      .then((v) => v === 'Corner Kitchen & Bar'),
    'resuming restores the work',
  )
  check(
    await page.getByRole('heading', { name: /venue’s details/i }).isVisible(),
    'and lands on the form, never back on the import screen they already passed',
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
      step: 'words',
      completed: ['basics', 'where', 'vibe', 'hours'],
      venue_name: 'Corner Kitchen & Bar',
      payload: { details: { venue_name: 'Corner Kitchen & Bar' } },
      modified: new Date(Date.now() - 2 * 86400_000).toISOString(),
    },
  }
  const { page, context } = await open({ draftEndpoints: true, store })
  await page.waitForTimeout(400)

  const text = (await card(page).innerText()).replace(/\n/g, ' ')
  check(/step 5 of 6, Description/.test(text), 'a server draft resumes at the right place')
  check(/Saved 2 days ago/.test(text), 'relative time is rounded down, not up')
  check(
    /emailed you this link/i.test(text),
    'with a real server draft the card DOES make the email promise',
  )
  // textContent, not innerText: the state words are sr-only, which is the point.
  const raw = await card(page).evaluate((n) => n.textContent)
  check(/The basics — done/.test(raw), 'section state is spelled out, not carried by colour alone')
  check(/Description — where you left off/.test(raw), 'and so is the one they are on')

  await context.close()
}

/* ============================================================================
   3. MENU IMPORT — on the venue's own menu screen

   ⚠️ REWRITTEN 17 Sep. This used to drive the wizard's menu STEP, which parsed
   the spreadsheet in the browser and showed a four-stage checklist while it
   worked. The menu left onboarding with that step — it does not hold up going
   live, and sitting in the middle of the flow said that it did — so the import
   is tested where it now lives.

   What was lost with the step is the client-side PARSE PROGRESS, not the
   import: `importMenu` posted to `bulk_import_products` and had no fallback, so
   a bench without the importer failed there too, just after a nicer wait. The
   venue's own screen uses the background importer instead, and what matters
   about it is the same thing that mattered before — that it tells the truth
   when it cannot do the job, and never sends the partner off to fix a file
   that was never broken.
   ========================================================================= */
{
  const { page, context } = await open()
  await page.goto(`${BASE}/venues/VEN-1/menu`, { waitUntil: 'networkidle' })
  await page.getByLabel('Menu file').waitFor({ timeout: 15000 })
  check(true, 'the import lives on the venue’s menu, reachable without the wizard')

  const CATS = ['Cocktails', 'Small Plates', 'Mains']
  const lines = ['heading,item_name,price,description']
  for (let i = 0; i < 200; i += 1) lines.push(`${CATS[i % 3]},Item ${i},${50 + (i % 40)},`)

  await page.getByLabel('Menu file').setInputFiles({
    name: 'winter-menu.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(lines.join('\n')),
  })
  await page.waitForTimeout(2500)

  const body = (await page.locator('main').innerText()).replace(/\n/g, ' ')

  /* THE ASSERTION THAT MATTERS, and the one this project keeps having to make:
     the importer is not deployed on this bench, and the partner must be told
     that in words that do not blame their spreadsheet. */
  check(
    /couldn’t start the import/i.test(body),
    'a missing importer is reported, not swallowed',
  )
  check(
    /Nothing is wrong with your file/i.test(body),
    'and it says so — a different file is not the answer, and sending them to look for one is',
  )
  check(
    /this is ours to fix/i.test(body),
    'it owns the problem rather than handing our deployment to a restaurant owner',
  )
  check(
    !/leave this page|emailed you the moment/i.test(body),
    'and it never promises "leave the page, we will email you" over an import that never started',
  )
  check(
    /Adding items by hand works normally/i.test(body),
    'the way forward is named in the same breath',
  )

  await context.close()
}

/* ============================================================================
   4. The way out is offered in the same breath as the problem
   ========================================================================= */
{
  const { page, context } = await open()
  await page.goto(`${BASE}/venues/VEN-1/menu`, { waitUntil: 'networkidle' })
  await page.getByLabel('Menu file').waitFor({ timeout: 15000 })

  const big = ['heading,item_name,price,description']
  for (let i = 0; i < 400; i += 1) big.push(`Cocktails,Drink ${i},${50 + (i % 40)},`)

  await page.getByLabel('Menu file').setInputFiles({
    name: 'huge.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(big.join('\n')),
  })
  await page.waitForTimeout(2500)

  /* An escape hatch that only appears once the import has failed is not an
     escape hatch — it is a consolation. It is offered while the partner is
     still waiting, and it is still offered afterwards. */
  check(
    await page.getByRole('button', { name: /add items by hand instead/i }).isVisible(),
    'the manual-entry escape hatch is offered, not left for the partner to find',
  )

  await context.close()
}

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed')
process.exit(fail.length ? 1 : 0)

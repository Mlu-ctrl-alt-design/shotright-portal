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
const VENUE = { name: 'V-1', venue_name: 'Corner Kitchen & Bar', workflow_state: 'Approved', moods: [] }

// A 1x1 PNG, served for every /files/... URL so tiles render a real image.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * `photoEndpoints: false` is TODAY — `get_venue_photos` and `set_venue_photos`
 * are not on the bench, so the portal must warn BEFORE the partner arranges
 * anything and must still upload. `true` simulates them deployed.
 */
async function open({ photoEndpoints = false, existingPhotos = [], deaf = false } = {}) {
  let stored = existingPhotos
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  const uploads = [] // { name, bytes }
  const saves = [] // whatever set_venue_photos was sent

  await page.route('**/files/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  )

  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname
    const missing = (method) => ({
      status: 404,
      json: {
        exc_type: 'DoesNotExistError',
        exception: `frappe.exceptions.DoesNotExistError: Method Not Found: ${method}`,
      },
    })

    if (p.startsWith('/api/resource/Mood'))
      return r.fulfill({ json: { data: [{ name: 'M1', mood_name: 'Chilled Bar' }] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [VENUE] } } })

    if (p.endsWith('/api/method/upload_file')) {
      const body = r.request().postDataBuffer()
      const raw = body ? body.toString('latin1') : ''
      const fileName = /filename="([^"]+)"/.exec(raw)?.[1] || 'unknown'
      uploads.push({
        name: fileName,
        bytes: body ? body.length : 0,
        form: raw,
        // The multipart body is one part; the JPEG runs from its SOI to the end.
        dims: body && /\.jpg$/.test(fileName)
          ? jpegSize(body.subarray(body.indexOf(Buffer.from([0xff, 0xd8, 0xff]))))
          : null,
      })
      return r.fulfill({
        json: {
          message: {
            name: `FILE-${uploads.length}`,
            file_url: `/files/${uploads.length}-${fileName}`,
            file_name: fileName,
          },
        },
      })
    }

    if (p.includes('get_venue_photos')) {
      if (!photoEndpoints) return r.fulfill(missing('shotright.api.get_venue_photos'))
      return r.fulfill({ json: { message: stored } })
    }
    if (p.includes('set_venue_photos')) {
      if (!photoEndpoints) return r.fulfill(missing('shotright.api.set_venue_photos'))
      const body = JSON.parse(r.request().postData() || '{}')
      saves.push(body)
      // `deaf` is the endpoint EXISTING but not UNDERSTANDING US — a parameter
      // spelt differently server-side, which Frappe drops at HTTP 200. It is
      // the failure the read-back exists to catch.
      if (!deaf) stored = body.photos || []
      return r.fulfill({ json: { message: stored } })
    }

    if (p.includes('create_venue'))
      return r.fulfill({ json: { message: { name: 'V-9', venue_name: 'Corner Kitchen & Bar' } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: VENUE } })
    if (p.includes('client.set_value')) return r.fulfill({ json: { message: {} } })

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  return { page, context, uploads, saves }
}

/**
 * Put real image bytes through the real <input type=file>.
 *
 * Drawn on a canvas in the page rather than shipped in as a fixture, because
 * the thing under test is the DOWNSCALER — it needs an image with genuine
 * dimensions, and a checked-in 3000px photo is a checked-in 3000px photo.
 */
const addPhoto = (page, { name, w = 800, h = 600, type = 'image/png', broken = false }) =>
  page.evaluate(
    async ({ name, w, h, type, broken }) => {
      let file
      if (broken) {
        file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], name, { type })
      } else {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        // Noise, so the encoder cannot collapse it to nothing and the byte
        // counts in the size assertions mean something.
        const img = ctx.createImageData(w, h)
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = (i * 7) % 255
          img.data[i + 1] = (i * 13) % 255
          img.data[i + 2] = (i * 29) % 255
          img.data[i + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
        const blob = await new Promise((res) => canvas.toBlob(res, type))
        file = new File([blob], name, { type })
      }
      const input = document.querySelector('input[type=file][aria-label*="choose files"]')
      const dt = new DataTransfer()
      dt.items.add(file)
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      return file.size
    },
    { name, w, h, type, broken },
  )

/** Width/height straight out of a JPEG's SOF marker.

    The claim under test is that a 3200px phone photo is DOWNSCALED before it
    leaves the browser. "The bytes got smaller" is weaker than it sounds — a
    PNG re-encoded as JPEG shrinks whatever the dimensions are. Reading the
    real pixel size is the only assertion that can fail for the right reason. */
function jpegSize(buf) {
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue }
    const marker = buf[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

const tiles = (page) =>
  page.locator('section[aria-labelledby="venue-photos-heading"] ul > li')

/** Wait for a photo to FINISH. A queued tile is an <li> too — counting them
    races the upload and reads the placeholder instead of the result. */
const settled = (page, name) =>
  page.locator(`section[aria-labelledby="venue-photos-heading"] img[alt="${name}"]`)
    .waitFor({ timeout: 15000 })

async function toDetailsStep(page) {
  await page.goto(`${BASE}/venues/new`, { waitUntil: 'networkidle' })
  await page.getByRole('textbox', { name: 'Mood', exact: true }).fill('Chilled Bar')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByLabel(/venue name/i).waitFor()
}

/** Coordinates are required — `find_venues` is a radius search, so a venue
    without a point saves, looks fine, and is never found. */
async function setLocation(page) {
  await page.getByLabel('Latitude', { exact: true }).fill('-26.2041')
  await page.getByLabel('Longitude', { exact: true }).fill('28.0473')
}

/* ============================================================================
   1. THE GAP ITSELF — there is now somewhere to put a venue photo
   ========================================================================= */
{
  const { page, context, uploads } = await open()
  await toDetailsStep(page)

  const region = page.locator('section[aria-labelledby="venue-photos-heading"]')
  check(await region.isVisible(), 'the wizard has a place to upload venue photos at all')

  const body = await region.evaluate((n) => n.textContent)
  check(/first photo is the one customers see/i.test(body), 'it says which photo is the cover')

  /* The promise, told BEFORE the work — not after submit. */
  check(
    /aren’t reaching customers yet/i.test(body),
    'with no endpoint on the bench, it says so before the partner arranges anything',
  )
  check(
    /upload properly/i.test(body) && /reviewers will see them/i.test(body),
    'and says what DOES happen, so "add them anyway" is a real instruction',
  )

  await addPhoto(page, { name: 'front-bar.png' })
  await settled(page, 'front-bar.png')
  check((await tiles(page).count()) === 1, 'a chosen photo appears as a tile')
  check(uploads.length === 1, 'and is uploaded immediately, not held until submit')
  check(
    /Cover/.test(await tiles(page).first().evaluate((n) => n.textContent)),
    'the first photo is marked as the cover, in a word and not only a colour',
  )

  await context.close()
}

/* ============================================================================
   2. THE PHONE PHOTO — downscaled in the browser, so nobody is asked to resize
   ========================================================================= */
{
  const { page, context, uploads } = await open()
  await toDetailsStep(page)

  // 3200x2400 — the shape of a photo off a current handset.
  const originalBytes = await addPhoto(page, { name: 'big-room.png', w: 3200, h: 2400 })
  await settled(page, 'big-room.png')

  const sent = uploads[0]
  check(/\.jpg$/.test(sent.name), 'an oversized photo is re-encoded, and renamed to match')
  check(
    sent.dims?.width === 2000 && sent.dims?.height === 1500,
    `3200x2400 was downscaled to 2000x${sent.dims?.height} before it left the browser`,
  )
  check(
    sent.bytes < originalBytes / 2,
    `and got much smaller on the way (${Math.round(originalBytes / 1024)} KB -> ${Math.round(sent.bytes / 1024)} KB)`,
  )

  const dims = await page.locator('section[aria-labelledby="venue-photos-heading"] img').first()
    .evaluate((n) => n.getAttribute('alt'))
  check(dims === 'big-room.png', 'the tile keeps the partner’s own filename as its alt text')

  await context.close()
}

/* ============================================================================
   3. ORDER IS DATA — reorder, cover moves, and it is announced
   ========================================================================= */
{
  const { page, context } = await open()
  await toDetailsStep(page)

  await addPhoto(page, { name: 'one.png' })
  await settled(page, 'one.png')
  await addPhoto(page, { name: 'two.png' })
  await settled(page, 'two.png')
  await addPhoto(page, { name: 'three.png' })
  await settled(page, 'three.png')

  check((await tiles(page).count()) === 3, 'three photos, three tiles')

  // Move the third to the front, one step at a time — the partner's best shot.
  await page.getByRole('button', { name: /Move three\.png earlier, to position 2 of 3/ }).click()
  await page.getByRole('button', { name: /Move three\.png earlier, to position 1 of 3/ }).click()

  const first = await tiles(page).first().evaluate((n) => n.textContent)
  check(/Cover/.test(first), 'the cover badge follows the photo that was moved to the front')
  check(
    (await tiles(page).first().locator('img').getAttribute('alt')) === 'three.png',
    'and it is the right photo',
  )

  const live = await page.locator('section[aria-labelledby="venue-photos-heading"] [role="status"]')
    .evaluate((n) => n.textContent)
  check(
    /moved to position 1 of 3/.test(live) && /now the cover photo/i.test(live),
    'the move is announced, including that it changed which photo customers see',
  )

  // Removing the cover must say who inherited it.
  await page.getByRole('button', { name: /Remove three\.png/ }).click()
  const afterRemove = await page.locator('section[aria-labelledby="venue-photos-heading"] [role="status"]')
    .evaluate((n) => n.textContent)
  check(
    /is now the cover photo/i.test(afterRemove),
    'removing the cover announces which photo takes its place',
  )
  check((await tiles(page).count()) === 2, 'and the photo is gone')

  await context.close()
}

/* ============================================================================
   4. WHAT GOES WRONG — a file we cannot open, said in words that help
   ========================================================================= */
{
  const { page, context, uploads } = await open()
  await toDetailsStep(page)

  await addPhoto(page, { name: 'braai-night.heic', type: 'image/heic', broken: true })
  await page.waitForTimeout(600)

  const body = await page.locator('section[aria-labelledby="venue-photos-heading"]')
    .evaluate((n) => n.textContent)
  check(/HEIC/.test(body), 'an iPhone HEIC photo is named for what it is')
  check(
    /Settings → Camera → Formats → Most Compatible/.test(body),
    'and the message is the two taps that fix it, not "unsupported file type"',
  )
  check(uploads.length === 0, 'nothing was uploaded')
  check((await tiles(page).count()) === 0, 'and no tile pretends otherwise')

  await context.close()
}

/* ============================================================================
   5. THE WHOLE WAY THROUGH — draft, review, submit, and an honest warning
   ========================================================================= */
{
  const { page, context } = await open()
  await toDetailsStep(page)

  await page.getByLabel(/venue name/i).fill('Corner Kitchen & Bar')
  await setLocation(page)
  await addPhoto(page, { name: 'front-bar.png' })
  await settled(page, 'front-bar.png')
  await addPhoto(page, { name: 'terrace.png' })
  await settled(page, 'terrace.png')

  await page.waitForTimeout(1800) // past the autosave debounce
  const draft = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('shotright.venueDrafts') || '{}')
    return Object.values(all)[0]
  })
  check(
    draft?.payload?.photos?.length === 2,
    'photos ride along in the saved draft, so coming back tomorrow keeps them',
  )
  check(
    typeof draft?.payload?.photos?.[0]?.file_url === 'string',
    'as urls — which is the whole reason they upload now rather than at submit',
  )

  // Details → hours → menu → review.
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('heading', { name: /Almost done/i }).waitFor()

  const review = await page.locator('main').evaluate((n) => n.textContent)
  check(
    /2 photos, in order/.test(review),
    'the review screen shows the gallery — the one thing you cannot check by re-reading a field',
  )
  const reviewCover = page.locator('main img[alt="front-bar.png"]')
  check(await reviewCover.isVisible(), 'with the real photos, in the partner’s order')

  await page.getByRole('button', { name: 'Submit' }).click()
  await page.getByText(/Chisa|submitted|review/i).first().waitFor({ timeout: 8000 })

  const success = await page.locator('main').evaluate((n) => n.textContent)
  check(
    /won’t appear to customers yet/i.test(success),
    'submitting with no photo endpoint warns that the photos are not live',
  )
  check(
    /Nothing has been lost/i.test(success),
    'and says they are not lost, because "not live" and "gone" are different things',
  )

  await context.close()
}

/* ============================================================================
   6. THE DAY THE BACKEND SHIPS — no release, no warning, order preserved
   ========================================================================= */
{
  const { page, context, saves } = await open({ photoEndpoints: true })
  await toDetailsStep(page)

  const region = page.locator('section[aria-labelledby="venue-photos-heading"]')
  const body = await region.evaluate((n) => n.textContent)
  check(
    !/aren’t reaching customers yet/i.test(body),
    'with the endpoint deployed, the warning is gone — no frontend release involved',
  )

  await page.getByLabel(/venue name/i).fill('Corner Kitchen & Bar')
  await setLocation(page)
  await addPhoto(page, { name: 'one.png' })
  await settled(page, 'one.png')
  await addPhoto(page, { name: 'two.png' })
  await settled(page, 'two.png')
  await page.getByRole('button', { name: /Move two\.png earlier/ }).click()

  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.getByText(/Chisa|submitted|review/i).first().waitFor({ timeout: 8000 })

  check(saves.length === 1, 'the photo set is sent to the backend on submit')
  const sent = saves[0]?.photos || []
  check(sent.length === 2, 'both photos')
  check(
    sent[0]?.file_name === 'two.png' && sent[0]?.idx === 1 && sent[0]?.is_cover === true,
    'in the order the partner chose, with the cover flagged',
  )
  check(
    typeof sent[0]?.file === 'string',
    'carrying the File docname, so the backend links rather than re-uploads',
  )

  const success = await page.locator('main').evaluate((n) => n.textContent)
  check(
    !/won’t appear to customers yet/i.test(success),
    'and the partner is not warned about a problem that no longer exists',
  )

  await context.close()
}

/* ============================================================================
   7. AN EXISTING VENUE — photos can be added after the fact too
   ========================================================================= */
{
  const { page, context, uploads } = await open({
    photoEndpoints: true,
    existingPhotos: [
      { file: 'FILE-A', file_url: '/files/old-bar.png', file_name: 'old-bar.png', idx: 1, is_cover: true },
    ],
  })
  await page.goto(`${BASE}/venues/V-1/edit`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Photos of this venue' }).waitFor()

  check((await tiles(page).count()) === 1, 'an existing venue shows the photos it already has')

  await addPhoto(page, { name: 'new-terrace.png' })
  await settled(page, 'new-terrace.png')
  check((await tiles(page).count()) === 2, 'and a new one can be added to it')

  check(uploads.length === 1, 'the photo uploaded')
  check(
    /name="docname"[\s\S]{0,40}V-1/.test(uploads[0].form) && /name="doctype"[\s\S]{0,40}Venue/.test(uploads[0].form),
    'and, because this venue already exists, went up attached to it — a reviewer sees it in Desk today',
  )

  await context.close()
}

/* ============================================================================
   8. AN EXISTING VENUE, NO ENDPOINT — the warning comes from the read
   ========================================================================= */
{
  const { page, context } = await open({ photoEndpoints: false })
  await page.goto(`${BASE}/venues/V-1/edit`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Photos of this venue' }).waitFor()
  await page.waitForTimeout(400)

  const body = await page.locator('section[aria-labelledby="venue-photos-heading"]')
    .evaluate((n) => n.textContent)
  check(
    /don’t reach customers yet/i.test(body),
    'an existing venue says the same thing, learned from the read rather than a probe',
  )
  check(
    /order below isn’t saved/i.test(body),
    'and is specific about which part does not stick',
  )

  await context.close()
}

/* ============================================================================
   9. DEPLOYED BUT DEAF — the endpoint answers 200 and keeps nothing
   ========================================================================= */
{
  /* The failure that became possible the moment the photo backend went live.
     `withFallback` only asks "does the method exist?". If `photos` is spelt
     differently server-side Frappe drops the argument, saves nothing, and
     returns 200 — and the probe has already told the uploader it is safe to
     promise these reach customers. That is worse than the missing endpoint we
     started with, because nobody is looking for it. */
  const { page, context, saves } = await open({ photoEndpoints: true, deaf: true })
  await toDetailsStep(page)
  await page.getByLabel(/venue name/i).fill('Corner Kitchen & Bar')
  await setLocation(page)
  await addPhoto(page, { name: 'one.png' })
  await settled(page, 'one.png')
  await addPhoto(page, { name: 'two.png' })
  await settled(page, 'two.png')

  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Submit' }).click()
  await page.getByText(/Chisa|submitted|review/i).first().waitFor({ timeout: 8000 })

  check(saves.length === 1, 'the save was attempted and answered 200')
  const success = await page.locator('main').evaluate((n) => n.textContent)
  check(
    /only kept 0 of 2/i.test(success),
    'the portal reads back after writing and catches that nothing was stored',
  )
  check(
    !/no field for a venue’s pictures/i.test(success),
    'and does not blame a missing field — the endpoint is there, it just did not keep them',
  )
  check(/Nothing has been lost/i.test(success), 'the partner is still told their photos are safe')

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

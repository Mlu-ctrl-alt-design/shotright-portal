import { chromium } from 'playwright'

/**
 * "THE IMAGES UPLOADED SEEM TO NOT PERSIST" — and the preview screen.
 *
 * Reported 28 Jul. They did persist. `getVenuePhotos` falls back to listing the
 * Venue's File attachments when `get_venue_photos` isn't deployed, and that
 * fallback's catch returned `{photos: [], ordered: false}` — the SAME value as a
 * venue that genuinely has none. So when the File listing was refused (a
 * perfectly reasonable thing for a bench to deny the Vendor role) the uploader
 * came back empty, and a partner who had added six photos concluded they had
 * been thrown away.
 *
 * That is the third time in one day that an empty result and a failed read have
 * rendered as the same screen — after the decline notes and the venue detail
 * 404. It is the defining bug of this project.
 *
 * Second half: the preview. A partner fills in eleven fields across five steps
 * and never sees the thing they are making; the first look at it as a customer
 * would is otherwise after it goes live. The assertions that matter are that it
 * does NOT flatter — a missing photo shows as a hole, not as a tidier card.
 */

const BASE = 'http://127.0.0.1:4173'
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const fail = []
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) fail.push(label)
}

const VENUE = {
  name: 'V-1',
  venue_name: 'Corner Kitchen & Bar',
  address: '12 Long St, Cape Town',
  latitude: -33.92,
  longitude: 18.42,
  dress_code: 'Smart casual',
  atmosphere_desc: 'Loud, warm, good for a long table.',
  workflow_state: 'Approved',
  moods: ['MOOD-CHILLED'],
  operating_hours: [
    { day_of_week: 'Monday', open_time: '17:00', close_time: '23:00', closed: 0 },
  ],
}

const PHOTOS = [
  { name: 'F1', file_url: '/files/front.jpg', file_name: 'front.jpg' },
  { name: 'F2', file_url: '/files/bar.jpg', file_name: 'bar.jpg' },
]

const MENU = [
  {
    name: 'H1',
    heading: 'Bar',
    items: [
      { name: 'I1', item_name: 'Draught', price: 40 },
      { name: 'I2', item_name: 'House red', price: 0 },
    ],
  },
]

const missing = (m) => ({
  status: 404,
  json: {
    exc_type: 'DoesNotExistError',
    exception: `frappe.exceptions.DoesNotExistError: Method Not Found: ${m}`,
  },
})

/**
 * @param photos  'endpoint' | 'attachments' | 'unreadable' | 'none'
 */
async function open({ photos = 'endpoint', venue = VENUE, menu = MENU } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: { email: 'a@b.c' }, stats: {}, venues: [venue] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: venue } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: menu } })

    if (p.includes('get_venue_photos')) {
      if (photos === 'endpoint') return r.fulfill({ json: { message: PHOTOS } })
      return r.fulfill(missing('shotright.api.get_venue_photos'))
    }

    if (p.includes('frappe.client.get_list')) {
      if (photos === 'attachments') return r.fulfill({ json: { message: PHOTOS } })
      if (photos === 'none') return r.fulfill({ json: { message: [] } })
      // 'unreadable' — the reported case. A bench that won't let a Vendor list
      // File rows. Nothing is wrong with their photos.
      return r.fulfill({
        status: 403,
        json: { exc_type: 'PermissionError', exception: 'frappe.exceptions.PermissionError' },
      })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  return { page, context }
}

const photoCard = async (page) => {
  await page.goto(`${BASE}/venues/V-1/edit`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Photos of this venue' }).waitFor()
  await page.waitForTimeout(500)
  return page
    .locator('section[aria-labelledby="venue-photos-heading"]')
    .evaluate((n) => n.textContent)
}

/* ============================================================================
   1. THE REPORTED BUG — a failed read must not read as "you have none"
   ========================================================================= */
{
  const { page, context } = await open({ photos: 'unreadable' })
  const body = await photoCard(page)

  check(
    /can’t show you the photos already on this venue/i.test(body),
    'an unreadable list says so, instead of rendering as an empty uploader',
  )
  check(/aren’t lost/i.test(body), 'and says the photos are not lost')
  check(
    /Anything you add here is uploaded and kept/i.test(body),
    'and that adding more still works, so they are not stuck',
  )
  check(
    /risk duplicates/i.test(body),
    'with the one genuine consequence named — they cannot see what is already there',
  )

  await context.close()
}

/* ============================================================================
   2. A VENUE THAT REALLY HAS NO PHOTOS SAYS NOTHING OF THE SORT
   ========================================================================= */
{
  /* The fix must not turn into "always claim there might be hidden photos".
     An empty venue is an ordinary state and gets the ordinary empty box. */
  const { page, context } = await open({ photos: 'none' })
  const body = await photoCard(page)

  check(
    !/can’t show you the photos already on this venue/i.test(body),
    'a genuinely empty venue is not told its photos are hidden somewhere',
  )
  check(/Drag photos here/i.test(body), 'it just gets the normal empty uploader')

  await context.close()
}

/* ============================================================================
   3. PHOTOS THAT DO COME BACK ARE SHOWN
   ========================================================================= */
{
  const { page, context } = await open({ photos: 'attachments' })
  const body = await photoCard(page)

  check(body.includes('front.jpg'), 'attachments found by the fallback are listed')
  check(
    !/can’t show you the photos already on this venue/i.test(body),
    'and no unreadable warning is shown when the read worked',
  )
  check(
    /don’t reach customers yet/i.test(body),
    'but the ordering caveat still applies, because that endpoint is still missing',
  )

  await context.close()
}

/* ============================================================================
   4. THE COVER LABEL SAYS WHAT HAPPENS, NOT WHAT IT IS CALLED
   ========================================================================= */
{
  /* Turo: "Guests will see this photo first". eBay badges it "Main". The first
     tells you the consequence; the second names a slot you then have to reason
     about. A partner who reads the consequence reorders. */
  const { page, context } = await open({ photos: 'endpoint' })
  const body = await photoCard(page)

  check(
    /Customers see this one first/i.test(body),
    'the lead photo is labelled by its consequence',
  )
  check(
    /The room, full|The bar|A table laid/i.test(body),
    'and named shots are suggested rather than "take good photos"',
  )

  await context.close()
}

/* ============================================================================
   5. THE PREVIEW SHOWS THE LISTING AS A CUSTOMER GETS IT
   ========================================================================= */
{
  const { page, context } = await open({ photos: 'endpoint' })
  await page.goto(`${BASE}/venues/V-1/preview`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const body = await page.locator('main').evaluate((n) => n.textContent)

  check(/How customers will see this/i.test(body), 'the preview screen exists')
  check(
    /not exactly how it’s laid out/i.test(body),
    'and is honest that it is a content preview, not a copy of the customer app',
  )
  check(body.includes('Corner Kitchen & Bar'), 'the name is there')
  check(body.includes('12 Long St, Cape Town'), 'the address is there')
  check(body.includes('Draught'), 'the menu is there')
  check(body.includes('R40'), 'with prices as a customer sees them')
  check(body.includes('No price'), 'and an unpriced item shown as unpriced, not hidden')
  check(
    await page.locator('img[alt*="Cover photo"]').count(),
    'the first photo is used as the cover, which is the whole point of the ordering',
  )

  await context.close()
}

/* ============================================================================
   6. THE PREVIEW DOES NOT FLATTER
   ========================================================================= */
{
  /* A preview that quietly collapses around missing pieces is worse than none,
     because it actively reassures. Every gap is shown as the gap it will be. */
  const bare = {
    ...VENUE,
    atmosphere_desc: '',
    moods: [],
    operating_hours: [],
    dress_code: '',
  }
  const { page, context } = await open({ photos: 'none', venue: bare, menu: [] })
  await page.goto(`${BASE}/venues/V-1/preview`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const body = await page.locator('main').evaluate((n) => n.textContent)

  check(/customers see a blank space here/i.test(body), 'no photo is shown as a blank space')
  check(/No description/i.test(body), 'a missing description is named')
  check(/won’t come up in any mood search/i.test(body), 'no moods is stated as the consequence it is')
  check(/can’t tell if you’re open tonight/i.test(body), 'and so are missing hours')
  check(/customers see an empty tab/i.test(body), 'an empty menu is shown as an empty tab')

  await context.close()
}

/* ============================================================================
   7. AND THERE IS A WAY IN
   ========================================================================= */
{
  const { page, context } = await open()
  await page.goto(`${BASE}/venues`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  const link = page.getByRole('link', { name: /Preview Corner Kitchen & Bar as customers see it/i })
  check(await link.count(), 'every venue row offers a preview')
  await link.first().click()
  await page.waitForURL(/\/venues\/V-1\/preview/)
  check(true, 'and it opens')

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

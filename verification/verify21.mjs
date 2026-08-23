import { chromium } from 'playwright'

/**
 * THE VENDOR ROLE HAS NO PERMISSION ON `Venue`, AND THAT IS FINE.
 *
 * Reported 28 Jul, a real partner uploading a photo to their own venue:
 *
 *   cosmos_1492129323.jpeg didn’t upload: User <strong>mlumanda@gmail.com</strong>
 *   does not have doctype access via role permission for document
 *   <strong>Venue</strong> Try again.
 *
 * Two separate failures in one line.
 *
 * ⚠️ UPDATED 22 Aug. `doctype: 'Venue'` is a PERMANENT 403 — vendors hold
 * ["All","Guest"] and Venue grants write to System Manager / Venue Reviewer
 * only — and the attach grant must never be added, because Frappe role
 * permissions are not row-scoped. Attaching now goes through the whitelisted
 * `shotright.api.upload_venue_photo`, which elevates internally. The
 * requirements below are unchanged; only the mechanism moved.
 *
 * 1. THE UPLOAD. Stock `upload_file` with `doctype: 'Venue'` needs write
 *    permission on the Venue doc. The Vendor role hasn't got any — everything
 *    goes through whitelisted `shotright.api.*` methods that elevate
 *    internally, which is a sound way to build a Frappe app. So attaching is
 *    something this bench will never do for us, and failing the whole upload
 *    over it throws away a photograph that was perfectly fine. It also explains
 *    the two symptoms we chased separately: `frappe.client.get_list` on File
 *    and `attachOrphans` are refused for exactly the same reason.
 *
 * 2. THE SENTENCE. `<strong>` and all, on a restaurant owner's screen. Frappe
 *    writes its messages as HTML and we render them as text — React escapes it
 *    correctly, so the partner reads the angle brackets. Told, in markup, about
 *    a doctype.
 *
 * "Try again" was the worst part: it was never going to work.
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

/** 1x1 PNG. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const VENUE = {
  name: 'V-1',
  venue_name: 'Corner Kitchen & Bar',
  address: '12 Long St',
  latitude: -33.92,
  longitude: 18.42,
  workflow_state: 'Approved',
  moods: ['M1'],
  operating_hours: [{ day_of_week: 'Monday', open_time: '17:00', close_time: '23:00', closed: 0 }],
}

/** The exact body the bench sent, markup included. */
const PERMISSION_HTML =
  'User <strong>mlumanda@gmail.com</strong> does not have doctype access via ' +
  'role permission for document <strong>Venue</strong>'

/**
 * @param attach  'denied' reproduces the report; 'allowed' is a bench that
 *                grants the Vendor role attach rights; 'broken' is a genuine
 *                upload failure that must NOT be retried away.
 */
async function open({ attach = 'denied' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  const uploads = []

  await page.route('**/files/**', (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  )

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname

    if (p.startsWith('/api/resource/Mood'))
      return r.fulfill({ json: { data: [{ name: 'M1', mood_name: 'Chilled' }] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: { email: 'a@b.c' }, stats: {}, venues: [VENUE] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: VENUE } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    /* BOTH upload paths. As of 22 Aug the portal attaches via the whitelisted
       `upload_venue_photo`, which elevates internally; `upload_file` is only
       the wizard's path, where no venue exists yet. "Attaching" is therefore
       decided by WHICH ENDPOINT was called, not by a `doctype` part — that part
       is never sent any more, because `doctype=Venue` is a permanent 403. */
    if (
      p.endsWith('/api/method/upload_file') ||
      p.endsWith('/api/method/shotright.api.upload_venue_photo')
    ) {
      const raw = r.request().postDataBuffer()?.toString('latin1') || ''
      const attaching = p.endsWith('upload_venue_photo') || /name="venue_name"/.test(raw)
      uploads.push({ attaching })

      if (attach === 'broken') {
        return r.fulfill({
          status: 413,
          json: {
            exc_type: 'FileSizeExceededError',
            _server_messages: JSON.stringify([
              JSON.stringify({ message: 'File size exceeded the maximum allowed size' }),
            ]),
          },
        })
      }

      if (attaching && attach === 'denied') {
        return r.fulfill({
          status: 403,
          json: {
            exc_type: 'PermissionError',
            exception: `frappe.exceptions.PermissionError: ${PERMISSION_HTML}`,
            _server_messages: JSON.stringify([JSON.stringify({ message: PERMISSION_HTML })]),
          },
        })
      }

      return r.fulfill({
        json: {
          message: {
            name: `FILE-${uploads.length}`,
            file_url: `/files/${uploads.length}-photo.jpg`,
            file_name: 'photo.jpg',
          },
        },
      })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/V-1/edit`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Photos of this venue' }).waitFor()
  return { page, context, uploads }
}

const addPhoto = async (page, name = 'cosmos_1492129323.jpeg') => {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: PIXEL,
  })
  await page.waitForTimeout(1500)
}

const card = (page) =>
  page.locator('section[aria-labelledby="venue-photos-heading"]').evaluate((n) => n.textContent)

/* ============================================================================
   1. THE PERMISSION LANDED — a refusal is now an anomaly, and is loud

   These assertions used to say the opposite: a refused attach was retried
   WITHOUT the doctype, so the photo went up unattached rather than being lost.
   That was right while the wall was permanent.

   The Vendor role can attach to `Venue` as of 28 Jul, so the retry is gone —
   and its removal is the point, not a tidy-up. What it produced was a photo
   that uploaded, appeared in the uploader, and was attached to nothing: the
   partner saw success, the moderator opened the Venue and saw no pictures, and
   nobody was placed to notice the difference. A quiet wrong result.

   What has NOT changed is that the partner never reads a sentence about
   doctypes, and is never told to try again at something that cannot work.
   ========================================================================= */
{
  const { page, context, uploads } = await open({ attach: 'denied' })
  await addPhoto(page)

  check(uploads.length === 1, 'a refused attach is no longer retried unattached')
  check(uploads[0].attaching === true, 'the upload attaches to the venue, which is now allowed')

  const body = await card(page)
  check(
    /couldn’t attach cosmos_1492129323.jpeg to this venue/i.test(body),
    'a refusal is reported plainly, rather than silently producing an orphan photo',
  )
  check(
    /our problem and not yours/i.test(body),
    'and owned, because a role permission is not something a partner can fix',
  )
  check(
    !/Try again/i.test(body),
    'without "try again" — the tenth attempt is refused exactly like the first',
  )
  check(
    !/doctype access|role permission/i.test(body),
    'and still never a sentence about doctypes and role permissions',
  )

  await context.close()
}

/* ============================================================================
   2. NO FRAPPE MARKUP REACHES A PARTNER, EVER
   ========================================================================= */
{
  /* `frappe.throw` takes HTML, `_server_messages` carries it through, and we
     render messages as text — so <strong> arrived on screen as five characters
     of punctuation around an email address. */
  const { page, context } = await open({ attach: 'broken' })
  await addPhoto(page)

  const body = await card(page)
  check(/didn’t upload/i.test(body), 'a genuine failure IS reported')
  check(!/<strong>|&lt;strong|<\/strong>/i.test(body), 'but with no HTML tags in it')
  check(
    /File size exceeded/i.test(body),
    'the server’s actual words survive the stripping — only the markup goes',
  )

  await context.close()
}

/* ============================================================================
   3. NO FAILURE EVER LEAVES A TILE BEHIND
   ========================================================================= */
{
  /* Whatever went wrong, the uploader must not show a photo that isn't on the
     server. A tile is the partner's evidence that something worked. */
  const { page, context, uploads } = await open({ attach: 'broken' })
  await addPhoto(page)

  check(uploads.length === 1, 'a failed upload is attempted once')
  check(
    !(await page.locator('img[alt="cosmos_1492129323.jpeg"]').count()),
    'and no tile pretends the photo is there',
  )

  await context.close()
}
{
  const { page, context } = await open({ attach: 'denied' })
  await addPhoto(page)
  check(
    !(await page.locator('img[alt="cosmos_1492129323.jpeg"]').count()),
    'a refused attach leaves no tile either — the photo is not on the venue',
  )
  await context.close()
}

/* ============================================================================
   4. THE ORDINARY PATH — attached, and the partner is not made to think about it
   ========================================================================= */
{
  const { page, context, uploads } = await open({ attach: 'allowed' })
  await addPhoto(page)

  check(uploads.length === 1, 'one call')
  check(uploads[0].attaching === true, 'the photo is attached to the venue for reviewers')
  check(
    await page.locator('img[alt="cosmos_1492129323.jpeg"]').count(),
    'and shown, under the name the partner gave it',
  )
  const body = await card(page)
  check(!/couldn’t attach|didn’t upload/i.test(body), 'with nothing said about permissions at all')

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

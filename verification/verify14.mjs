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

const VENUE = { name: 'V-1', venue_name: 'Corner Kitchen & Bar', workflow_state: 'Approved', moods: [] }

/**
 * The backend shipped the background menu import (§6) BEFORE outgoing mail (§8).
 *
 * That window is the whole point of this suite. "You can leave" became true the
 * moment the import was a server job. "We'll email you" is a different promise
 * needing a different thing, and for as long as mail is unconfigured the portal
 * must not make it — or every partner is told to close the tab and wait for a
 * message that is never sent.
 *
 * `mail` — whether the import job reports that a message is actually coming.
 */
async function open({ mail = false, profile = {}, profileWrite = 'full' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  const saved = {
    first_name: 'Thabo',
    last_name: 'Mokoena',
    business_name: 'Daystar',
    phone: '+27 82 000 0000',
    email: 'a@b.c',
    ...profile,
  }
  const writes = []

  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname
    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: saved, stats: {}, venues: [VENUE] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: VENUE } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    if (p.includes('update_vendor_profile')) {
      const body = JSON.parse(r.request().postData() || '{}')
      writes.push(body)
      // 'deaf' is Frappe dropping an undeclared kwarg: HTTP 200, nothing stored.
      for (const [k, v] of Object.entries(body)) {
        if (profileWrite === 'deaf' && k === 'phone') continue
        saved[k] = v
      }
      return r.fulfill({ json: { message: { ok: true } } })
    }

    if (p.endsWith('/api/method/upload_file'))
      return r.fulfill({ json: { message: { name: 'FILE-1', file_url: '/files/menu.csv' } } })

    if (p.includes('start_menu_import'))
      return r.fulfill({
        json: {
          message: {
            name: 'MI-1',
            status: 'Queued',
            stage: 'uploaded',
            // The signal. Absent or false = mail is not sending yet.
            ...(mail ? { will_notify: true } : {}),
          },
        },
      })
    if (p.includes('get_menu_import_status'))
      return r.fulfill({
        json: {
          message: {
            name: 'MI-1',
            status: 'In Progress',
            stage: 'reading',
            total: 400,
            processed: 40,
            categories_found: 4,
            ...(mail ? { will_notify: true } : {}),
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
  return { page, context, writes, saved }
}

const startImport = async (page) => {
  await page.goto(`${BASE}/venues/V-1/menu`, { waitUntil: 'networkidle' })
  await page.getByLabel('Menu file').setInputFiles({
    name: 'menu.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('heading,item_name,price,description\nBar,Beer,40,\n'),
  })
  await page.waitForTimeout(1200)
}

/* ============================================================================
   1. THE WINDOW WE ARE IN — import deployed, mail not
   ========================================================================= */
{
  const { page, context } = await open({ mail: false })
  await startImport(page)

  const body = await page.locator('main').evaluate((n) => n.textContent)
  check(/You don’t have to wait/.test(body), 'the partner is still told the work outlives the page')
  check(
    !/we’ll email you/i.test(body),
    'but NOT that we will email them — mail is not sending, so that sentence would be a lie',
  )
  check(
    /come back whenever you like/i.test(body),
    'they get the honest, smaller promise instead: it keeps going and this panel picks it up',
  )

  await context.close()
}

/* ============================================================================
   2. THE DAY MAIL IS CONFIGURED — the sentence turns itself on
   ========================================================================= */
{
  const { page, context } = await open({ mail: true })
  await startImport(page)

  const body = await page.locator('main').evaluate((n) => n.textContent)
  check(
    /we’ll email you the moment your menu is ready/i.test(body),
    'with will_notify from the job, the email promise appears — no frontend release',
  )
  check(
    !/come back whenever you like/i.test(body),
    'and replaces the smaller one rather than sitting alongside it',
  )

  await context.close()
}

/* ============================================================================
   3. THE PHONE FIELD, UNLOCKED BY §2
   ========================================================================= */
{
  const { page, context, writes, saved } = await open({ profileWrite: 'full' })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  const phone = page.getByLabel('Phone')
  await phone.waitFor()

  check(await phone.isEditable(), 'the phone field is a control again, not a read-only echo')
  check(
    (await phone.inputValue()) === '+27 82 000 0000',
    'seeded from what the server holds',
  )

  await phone.fill('+27 71 555 1234')
  await page.getByRole('button', { name: /Save changes|Save/i }).first().click()
  await page.waitForTimeout(700)

  check(writes.some((w) => w.phone === '+27 71 555 1234'), 'and the number is actually sent')
  check(saved.phone === '+27 71 555 1234', 'and stored')
  const body = await page.locator('main').evaluate((n) => n.textContent)
  check(/Profile updated/i.test(body), 'reported as saved')
  check(!/did not stick/i.test(body), 'with no false warning')

  await context.close()
}

/* ============================================================================
   4. IF THE PARAMETER IS NAMED DIFFERENTLY, WE FIND OUT — NOT THE PARTNER
   ========================================================================= */
{
  /* The reason it was safe to make this editable without being able to check
     the signature. Frappe drops an undeclared kwarg at HTTP 200; the read-back
     catches it. */
  const { page, context } = await open({ profileWrite: 'deaf' })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await page.getByLabel('Phone').fill('+27 71 555 1234')
  await page.getByRole('button', { name: /Save changes|Save/i }).first().click()
  await page.waitForTimeout(700)

  const body = await page.locator('main').evaluate((n) => n.textContent)
  check(
    /your phone number did not stick/i.test(body),
    'a dropped phone kwarg is caught by the read-back and named',
  )
  check(/Everything else was saved/i.test(body), 'and the rest of the save is not called into doubt')
  check(
    (await page.getByLabel('Phone').inputValue()) === '+27 82 000 0000',
    'the field falls back to what the server actually holds',
  )

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

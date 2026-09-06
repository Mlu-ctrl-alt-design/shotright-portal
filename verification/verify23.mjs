import { chromium } from 'playwright'

/**
 * ACCEPTING THE LEGAL DOCUMENTS, IN A REAL BROWSER.
 *
 * The RTL suite covers the logic. This covers the two things only a real
 * browser and a real bundle can answer, and both of them are about consent
 * rather than about React:
 *
 *   - the document text renders as MARKUP a person can actually read, from a
 *     production build, in the page they are agreeing on. A legal document that
 *     arrives as escaped tag soup has not been shown to anybody.
 *   - the accept button issues exactly ONE write, and the screen's claim about
 *     what happened matches what went over the wire.
 *
 * The rule this file exists to enforce, in one sentence: the portal may never
 * show an acceptance it cannot prove.
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

const PROFILE = { email: 'a@b.c', first_name: 'Thabo', last_name: 'Mokoena' }
const VENUE = {
  name: 'VEN-00001',
  venue_name: 'Corner Kitchen & Bar',
  address: '12 Long St, Cape Town',
  workflow_state: 'Approved',
  moods: [],
}

/**
 * ⚠️ THE REAL CONTRACT, from the bench 5 Sep. The list and the text are two
 * separate calls, and `get_legal_documents` — which this stub used to serve —
 * has never existed:
 *
 *   get_required_consents()          -> [{policy_type, version}]
 *   get_legal_document(policy_type)  -> {name, policy_type, version, content,
 *                                        published_on}
 */
const TERMS = {
  name: 'Terms of Service-2.1',
  policy_type: 'Terms of Service',
  version: '2.1',
  published_on: '2026-08-01',
  content: '<p>You agree to keep your <strong>menu prices</strong> current.</p>',
  required: 1,
  accepted: 0,
}

/**
 * @param docs    what the list endpoint returns.
 * @param accept  'writes'  — records it, and the read-back shows it.
 *                'silent'  — 200, writes nothing. The Frappe kwarg bug.
 *                'missing' — endpoint not deployed.
 *                'throws'  — deployed and raising.
 */
async function open({ docs = [TERMS], accept = 'writes', list = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  const state = docs.map((d) => ({ ...d }))
  const writes = []

  await page.route('**/api/**', async (r) => {
    const p = new URL(r.request().url()).pathname
    const missing = (m) => ({
      status: 404,
      json: {
        exc_type: 'DoesNotExistError',
        exception: `frappe.exceptions.DoesNotExistError: Method Not Found: ${m}`,
      },
    })

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: PROFILE, stats: {}, venues: [VENUE] } } })
    if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: VENUE } })
    if (p.includes('get_venue_products')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_bookings')) return r.fulfill({ json: { message: [] } })

    // The consent list: policy types and versions, never the text.
    if (p.includes('get_required_consents')) {
      if (!list) return r.fulfill(missing('shotright.api.get_required_consents'))
      return r.fulfill({
        json: {
          message: state.map((d) => ({
            policy_type: d.policy_type,
            version: d.version,
            required: d.required,
            ...(d.accepted ? { accepted: 1, accepted_on: d.accepted_on } : {}),
          })),
        },
      })
    }

    // One document's text, addressed by policy type.
    if (p.includes('get_legal_document')) {
      const type = new URL(r.request().url()).searchParams.get('policy_type')
      const doc = state.find((d) => d.policy_type === type)
      return r.fulfill({
        json: {
          message: doc
            ? {
                name: doc.name,
                policy_type: doc.policy_type,
                version: doc.version,
                content: doc.content,
                published_on: doc.published_on,
              }
            : null,
        },
      })
    }

    if (p.includes('accept_legal_document')) {
      const body = JSON.parse(r.request().postData() || '{}')
      writes.push(body)
      if (accept === 'missing') return r.fulfill(missing('shotright.api.accept_legal_document'))
      if (accept === 'throws')
        return r.fulfill({
          status: 417,
          json: { exc_type: 'ValidationError', exception: 'frappe.exceptions.ValidationError' },
        })
      if (accept === 'writes') {
        const doc = state.find(
          (d) => d.name === body.document || d.policy_type === body.document,
        )
        if (doc) {
          doc.accepted = 1
          doc.accepted_on = '2026-08-07 10:15:00'
        }
      }
      // 'silent' falls through: a cheerful 200 over an untouched table.
      return r.fulfill({ json: { message: { ok: true } } })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await settle(page)
  return { page, context, writes }
}

/**
 * Wait for the legal query to have ANSWERED before asserting on the banner.
 *
 * Every "no banner is shown" check in this file is worthless without this, and
 * that is not hypothetical — the first run of this suite passed three of them
 * against a page where the request simply had not come back yet. A negative
 * assertion that fires before the data arrives tests nothing and reports
 * success, which is worse than a failure.
 */
async function settle(page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(700)
}

const text = (page) => page.locator('main').evaluate((n) => n.textContent)

const goLegal = async (page) => {
  await page.goto(`${BASE}/legal`, { waitUntil: 'networkidle' })
  await settle(page)
}

/* ============================================================================
   1. THE DOCUMENT IS ACTUALLY READABLE
   ========================================================================= */
{
  const { page, context } = await open()
  await goLegal(page)

  const body = await text(page)
  check(/You agree to keep your menu prices current/.test(body), 'the document text is on the page')
  check(
    await page.locator('.prose-editor strong', { hasText: 'menu prices' }).isVisible(),
    'and rendered as markup — escaped tag soup is not a document anybody has read',
  )
  check(/Version 2\.1/.test(body), 'the version is named')
  check(/1 August 2026/.test(body), 'and the date it took effect')

  await context.close()
}

/* ============================================================================
   2. ONE TICK, ONE WRITE, ONE TRUE CLAIM
   ========================================================================= */
{
  const { page, context, writes } = await open()
  await goLegal(page)

  const accept = page.getByRole('button', { name: 'Accept' })
  check(await accept.isDisabled(), 'Accept is out of reach until the box is ticked')

  await page.getByRole('checkbox').check()
  check(await accept.isEnabled(), 'and reachable once it is')

  await accept.click()
  await page.waitForTimeout(700)

  check(writes.length === 1, 'exactly one acceptance is written')
  check(writes[0].version === '2.1', 'carrying the version — "they agreed" alone answers nothing later')
  check(/You accepted this/i.test(await text(page)), 'and the screen says so, after the read-back')

  await context.close()
}

/* ============================================================================
   3. THE SILENT 200 — THE FAILURE THIS FEATURE IS BUILT AROUND

   Frappe drops kwargs a method does not declare, silently, at 200. Six shipped
   bugs on this project have that exact shape. On a menu price it costs a
   retype. Here it would print a fabricated agreement on screen, and nobody
   would find out until somebody went looking for the record.
   ========================================================================= */
{
  const { page, context } = await open({ accept: 'silent' })
  await goLegal(page)

  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Accept' }).click()
  await page.waitForTimeout(700)

  const body = await text(page)
  check(!/You accepted this/i.test(body), 'a 200 that wrote nothing does NOT read as accepted')
  check(/couldn’t record that/i.test(body), 'it is reported as a failure')
  check(/didn’t save/i.test(body), 'in words that say what did not happen')
  check(
    await page.getByRole('checkbox').isVisible(),
    'and the tickbox is still there, so trying again is possible',
  )

  await context.close()
}

/* ============================================================================
   4. NOT DEPLOYED, AND THROWING — NEITHER MAY LOOK LIKE SUCCESS
   ========================================================================= */
{
  const { page, context } = await open({ accept: 'missing' })
  await goLegal(page)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Accept' }).click()
  await page.waitForTimeout(700)

  const body = await text(page)
  check(!/You accepted this/i.test(body), 'a missing endpoint is not an acceptance')
  check(/haven’t saved anything/i.test(body), 'and says nothing was saved')
  check(/carry on with your venues/i.test(body), 'while making clear their business is not stuck')
  check(
    !/shotright\.api|endpoint|we’ve asked/i.test(body),
    'without handing a restaurant owner our deployment to think about',
  )

  await context.close()
}
{
  const { page, context } = await open({ accept: 'throws' })
  await goLegal(page)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Accept' }).click()
  await page.waitForTimeout(700)

  const body = await text(page)
  check(!/You accepted this/i.test(body), 'nor is a throw an acceptance')
  check(/couldn’t record that/i.test(body), 'and it says so')

  await context.close()
}

/* ============================================================================
   5. NO TICKBOX OVER A DOCUMENT NOBODY CAN READ
   ========================================================================= */
{
  const { page, context } = await open({ docs: [{ ...TERMS, content: '' }] })
  await goLegal(page)

  const body = await text(page)
  check(/can’t show you this document right now/i.test(body), 'an unreadable document says so')
  check(
    (await page.getByRole('checkbox').count()) === 0,
    'and offers nothing to tick — consent to an unread document is not consent',
  )
  check(/won’t ask you to agree to something you can’t read/i.test(body), 'and the reason is stated')

  await context.close()
}

/* ============================================================================
   6. THE BANNER, AND WHAT IT PROMISES
   ========================================================================= */
{
  const { page, context } = await open()

  const banner = page.getByRole('status')
  check(await banner.isVisible(), 'the banner is up wherever the partner is working')
  check(
    /One document needs your agreement/i.test(await banner.innerText()),
    'and counts what is outstanding',
  )
  check(
    /carry on as normal/i.test(await banner.innerText()),
    'it says what still works, so it is not read as an outage',
  )
  check(
    /can’t go to our reviewers/i.test(await banner.innerText()),
    'and names the one thing that does not, before they hit it',
  )

  await page.getByRole('link', { name: /Read and accept/i }).click()
  await page.waitForURL(/\/legal/)
  await settle(page)
  /* The bench carries no separate title — `policy_type` IS the name a partner
     reads, and "Terms of Service" is one of the three valid values. */
  check(/Terms of Service/.test(await text(page)), 'and it leads to the documents')
  check((await page.getByRole('status').count()) === 0, 'where it stops repeating itself')

  await context.close()
}

/* ============================================================================
   7. NOTHING OUTSTANDING, AND NOTHING AT ALL
   ========================================================================= */
{
  const { page, context } = await open({ docs: [{ ...TERMS, accepted: 1, accepted_on: '2026-08-07 10:15:00' }] })

  check((await page.getByRole('status').count()) === 0, 'an accepted partner sees no banner')

  await goLegal(page)
  const body = await text(page)
  check(/You’re up to date/i.test(body), 'and the screen confirms it')
  check(
    /You agree to keep your menu prices current/.test(body),
    'with the document still readable — they should never have to ask us for a copy',
  )

  await context.close()
}
{
  const { page, context } = await open({ docs: [] })
  check(
    (await page.getByRole('status').count()) === 0,
    'a bench with no legal documents shows no banner at all',
  )
  await context.close()
}

/* ============================================================================
   8. WE DO NOT ENFORCE WHAT WE CANNOT ASK

   A gate nobody can pass is an outage with a legal justification written on it.
   If the list endpoint is absent, we can neither show a partner what they are
   agreeing to nor record that they did — so we do not hold them to it.
   ========================================================================= */
{
  const { page, context } = await open({ list: false })

  check((await page.getByRole('status').count()) === 0, 'no banner is raised over a question we could not ask')

  await goLegal(page)
  const body = await text(page)
  check(/can’t show these right now/i.test(body), 'the screen is honest that it cannot read them')
  check(/nothing about your venues is affected/i.test(body), 'and that nothing else is affected')
  check(!/You’re up to date/i.test(body), 'and it does NOT tell them they are up to date, which it cannot know')
  check(
    !/shotright\.api|endpoint|we’ve asked/i.test(body),
    'still without naming a method or a server',
  )

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

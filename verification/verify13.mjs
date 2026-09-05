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

const OLD = 'Corner Kitchen & Bar'
const NEW = 'Corner Kitchen & Grill'

/**
 * REPORTED: editing a venue's name doesn't stick.
 *
 * `rename` — how the stubbed bench behaves on `update_venue`:
 *   'works'   the method renames (a `new_name` it understands)
 *   'ignored' 200, saves the other fields, silently drops the rename — which is
 *             what Frappe does with a kwarg the method does not declare
 *   'missing' the method is not deployed at all
 */
async function open({ rename = 'ignored' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))

  /**
   * This stub is a SERVER, so it stores what it is given.
   *
   * It used to echo fixed values for everything except the name and the dress
   * code, which meant any field the form sent came back unchanged — and once
   * the portal started reading a venue back to check the write landed, that
   * read as "the opening hours didn't save" on a suite about renaming. The
   * fake was the thing that was wrong: a real bench that accepts a field keeps
   * it. Only the deliberate failures below are modelled as failures.
   */
  const state = {
    venue_name: OLD,
    dress_code: 'Smart casual',
    address: '70 Juta St',
    latitude: -26.19,
    longitude: 28.03,
    atmosphere_desc: '',
    moods: ['MOOD-CHILLED'],
    operating_hours: [],
  }
  const updates = []

  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname
    // A venue must carry a mood and an open day or the form refuses to submit
    // at all — see venueValidation.js.
    const venue = () => ({ name: 'V-1', workflow_state: 'Approved', ...state })

    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: { email: 'a@b.c' }, stats: {}, venues: [venue()] } } })
    if (p.includes('get_moods')) return r.fulfill({ json: { message: [] } })
    if (p.includes('get_venue_photos')) return r.fulfill({ json: { message: [] } })

    if (p.includes('get_venue_detail')) {
      // The identifier the portal asks with. A rename that HASN'T happened must
      // still resolve under the old id, and one that has must resolve under the
      // new name — the same thing the real bench would do.
      const asked = u.searchParams.get('venue_name')
      const known = ['V-1', state.venue_name]
      return known.includes(asked)
        ? r.fulfill({ json: { message: venue() } })
        : r.fulfill({
            status: 404,
            json: { exc_type: 'DoesNotExistError', exception: `Venue ${asked} not found` },
          })
    }

    if (p.includes('update_venue')) {
      if (rename === 'missing')
        return r.fulfill({
          status: 404,
          json: {
            exc_type: 'DoesNotExistError',
            exception:
              'frappe.exceptions.DoesNotExistError: Method Not Found: shotright.api.update_venue',
          },
        })
      const body = JSON.parse(r.request().postData() || '{}')
      updates.push(body)

      // Everything the method understands is stored, the way a bench would.
      for (const [key, value] of Object.entries(body)) {
        if (key === 'venue_name' || key === 'new_name' || key === 'new_venue_name') continue
        state[key] = value
      }

      // 'ignored' is the Frappe default for an undeclared kwarg: HTTP 200, no
      // error, nothing written. That is what this suite is about, so the RENAME
      // is the one thing deliberately not stored unless the bench understands it.
      if (rename === 'works' && body.new_name) state.venue_name = body.new_name
      return r.fulfill({ json: { message: venue() } })
    }

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/V-1/edit`, { waitUntil: 'networkidle' })
  await page.getByLabel('Venue name').waitFor()
  return { page, context, updates, state }
}

const rename = async (page) => {
  await page.getByLabel('Venue name').fill(NEW)
  await page.getByRole('button', { name: /Save and resubmit/i }).click()
  await page.waitForTimeout(900)
}

/* ============================================================================
   1. THE BUG ITSELF — the identifier is no longer clobbered by the new name
   ========================================================================= */
{
  const { page, context, updates } = await open({ rename: 'ignored' })
  await rename(page)

  check(updates.length === 1, 'the update was sent')
  const sent = updates[0]
  check(
    sent.venue_name === 'V-1',
    'venue_name still identifies WHICH venue — it is no longer overwritten by the new name',
  )
  check(sent.new_name === NEW, 'and the new name travels under its own key')
  check(
    sent.new_venue_name === NEW,
    'under both plausible spellings, since Frappe drops the one it does not declare',
  )
  check(
    sent.workflow_state === undefined,
    'and workflow_state is no longer sent back — a client must never set its own approval state',
  )
  check(sent.name === undefined && sent.vendor_profile === undefined,
    'nor the rest of the loaded venue that the form was spreading wholesale')

  await context.close()
}

/* ============================================================================
   2. A RENAME THAT SILENTLY DID NOTHING IS REPORTED, NOT CELEBRATED
   ========================================================================= */
{
  const { page, context } = await open({ rename: 'ignored' })
  await rename(page)

  check(
    page.url().includes('/venues/V-1/edit'),
    'a partial save does not navigate away — walking the page on is how a silent failure becomes a belief',
  )
  const body = await page.locator('main').evaluate((n) => n.textContent)
  check(/Saved — but not all of it/i.test(body), 'it says something did not save')
  check(
    new RegExp(`still called “${OLD}”`).test(body),
    'and says exactly what the venue is actually called now',
  )
  check(/Everything else you changed was saved/i.test(body),
    'while making clear the rest of the edit did go through')

  const field = await page.getByLabel('Venue name').inputValue()
  check(
    field === OLD,
    'the name field is reset to what the server holds — leaving the typed name on screen under that warning is a page arguing with itself',
  )

  check(
    await page.getByRole('link', { name: /Carry on to the menu/i }).isVisible(),
    'and there is still a way forward — a warning you cannot walk away from is a trap',
  )

  await context.close()
}

/* ============================================================================
   3. WHEN IT WORKS, IT JUST WORKS
   ========================================================================= */
{
  const { page, context, state } = await open({ rename: 'works' })
  await rename(page)

  check(state.venue_name === NEW, 'a bench that understands new_name renames the venue')
  await page.waitForURL(/\/menu$/, { timeout: 5000 }).catch(() => {})
  check(page.url().endsWith('/menu'), 'and the partner is moved on as before')
  const body = await page.locator('main').evaluate((n) => n.textContent)
  check(!/but not all of it/i.test(body), 'with no warning about a problem that did not happen')

  await context.close()
}

/* ============================================================================
   4. EDITING SOMETHING OTHER THAN THE NAME IS UNAFFECTED
   ========================================================================= */
{
  const { page, context, updates } = await open({ rename: 'ignored' })
  await page.getByLabel('Dress code').fill('Formal')
  await page.getByRole('button', { name: /Save and resubmit/i }).click()
  await page.waitForTimeout(900)

  check(updates[0]?.new_name === undefined, 'no rename is claimed when the name was not touched')
  check(updates[0]?.dress_code === 'Formal', 'and the actual edit is sent')
  check(page.url().endsWith('/menu'), 'and it saves and moves on with no extra round trip')

  await context.close()
}

/* ============================================================================
   5. THE METHOD ISN'T THERE — say which one, not "DoesNotExistError"
   ========================================================================= */
{
  const { page, context } = await open({ rename: 'missing' })
  await rename(page)

  const body = await page.locator('main').evaluate((n) => n.textContent)
  /* UPDATED 28 Jul. These used to assert that the METHOD NAME appeared on
     screen, on the reasoning that naming it got it fixed faster. It did, and it
     was still wrong: a restaurant owner reading a dotted Python path has been
     handed our problem to hold. The name now goes to the console instead — see
     `withFallback` — so a screenshot still answers "which endpoint?" and no
     partner-facing screen mentions one.

     What survives unchanged is the requirement underneath: their data is
     intact, and they are told so in words they can act on. */
  check(/can’t save changes to this venue just yet/i.test(body),
    'a missing endpoint is reported as something the partner can understand')
  check(!/shotright\.api|update_venue/.test(body),
    'and NOT by naming the method at them')
  check(/Nothing you typed has been lost/i.test(body),
    'the partner is told their work and their venue are intact')
  check(!/DoesNotExistError/.test(body), 'never as a raw Frappe exception name')

  await context.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

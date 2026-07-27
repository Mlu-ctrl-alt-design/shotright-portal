import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const fail = []
const check = (ok, l) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) fail.push(l) }

const VENUE = { name: 'V-1', venue_name: 'Corner Kitchen & Bar', address: 'Soweto', workflow_state: 'Approved' }

/** `menu404` — 'method' = endpoint absent, 'doc' = venue absent, null = works. */
async function open(menu404) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))
  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname
    if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (p.includes('api.login')) return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
    if (p.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: { email: 'a@b.c', first_name: 'T' }, stats: {}, venues: [VENUE] } } })
    if (p.includes('get_venue_products')) {
      if (menu404 === 'method')
        // Exactly what Frappe sends when the dotted path does not resolve.
        return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError',
          exception: 'frappe.exceptions.DoesNotExistError: Method Not Found: shotright.api.get_venue_products' } })
      if (menu404 === 'doc')
        return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError',
          exception: 'frappe.exceptions.DoesNotExistError: Venue V-1 not found' } })
      return r.fulfill({ json: { message: [{ name: 'H1', heading: 'Cocktails', items: [] }] } })
    }
    if (p.includes('get_venue')) return r.fulfill({ json: { message: VENUE } })
    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c'); await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.waitForURL(`${BASE}/`)
  await page.goto(`${BASE}/venues/V-1/menu`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  return { page, context }
}

/* THE REPORTED BUG: the endpoint is not deployed. */
{
  const { page, context } = await open('method')
  const body = (await page.locator('main').innerText()).replace(/\n/g, ' ')
  check(!/^Not [Ff]ound/.test(body.trim()), 'a missing endpoint is no longer a bare "Not found"')
  check(/can’t read this menu from the server yet/i.test(body), 'it says what actually happened')
  check(/get_venue_products/.test(body), 'and names the exact method, so the backend can answer it')
  check(/has not been lost/i.test(body), 'and says the partner’s menu is not gone')
  check(await page.getByRole('button', { name: /Add heading/i }).isVisible(),
    'the page still works — a read failure does not lock the partner out of the whole screen')
  await context.close()
}

/* The OTHER 404: the venue itself. Still a real error. */
{
  const { page, context } = await open('doc')
  const body = (await page.locator('main').innerText()).replace(/\n/g, ' ')
  check(!/get_venue_products/.test(body), 'a missing VENUE is not reported as a missing endpoint')
  check(/couldn’t open this venue’s menu/i.test(body), 'it is still reported as an error, in words a restaurant owner can act on')
  check(!/DoesNotExistError/.test(body), 'and never as a raw Frappe exception name')
  await context.close()
}

/* And the happy path still works. */
{
  const { page, context } = await open(null)
  const body = (await page.locator('main').innerText()).replace(/\n/g, ' ')
  check(/Cocktails/.test(body), 'a working endpoint still renders the menu')
  check(!/can’t read this menu/.test(body), 'with no warning attached')
  await context.close()
}

console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed')
await browser.close()
process.exit(fail.length ? 1 : 0)

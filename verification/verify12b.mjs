import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const fail = []
const check = (ok, l) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) fail.push(l) }

/* The other half of "contact support": VITE_SUPPORT_EMAIL IS configured. */
const V = { name: 'V-9', venue_name: 'Shisanyama on 4th', workflow_state: 'Declined', moods: [] }
const context = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
const page = await context.newPage()
page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))
await page.route('**/api/**', (r) => {
  const p = new URL(r.request().url()).pathname
  if (p.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
  if (p.includes('api.login')) return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })
  if (p.includes('get_vendor_dashboard')) return r.fulfill({ json: { message: { profile: { email: 'a@b.c' }, stats: {}, venues: [V] } } })
  if (p.includes('get_venue_detail')) return r.fulfill({ json: { message: V } })
  if (p.includes('get_venue_review')) return r.fulfill({ json: { message: { state: 'Declined', notes: '', reviewed_on: '2026-07-25 14:02:11', fix_items: [] } } })
  return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
})
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.getByLabel('Email').fill('a@b.c'); await page.getByLabel('Password').fill('x')
await page.getByRole('button', { name: 'Login' }).click(); await page.waitForURL(`${BASE}/`)
await page.goto(`${BASE}/venues/V-9/review`, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: /What happens next/i }).waitFor()

const support = page.getByRole('button', { name: /Contact support/i })
check(await support.isVisible(), 'with an address configured, the support button is there')

/* No reason was given, so asking a human is the better move — and is weighted
   as such. Guessing at an edit with nothing to act on is not a next step. */
// textContent, not innerText: these buttons are `text-transform: uppercase`,
// and innerText returns the RENDERED casing, so both lookups miss.
const order = await page.evaluate(() => {
  const t = document.querySelector('main').textContent
  return { ask: t.indexOf('Contact support'), edit: t.indexOf('Edit and resubmit') }
})
check(order.ask < order.edit, 'and leads, because with no reason given an edit is a guess')

await support.click()
await page.getByLabel(/What would you like to ask/i).fill('Which part of the listing is the problem?')
const href = await page.getByRole('link', { name: /Open my email/i }).getAttribute('href')
check(href.startsWith('mailto:help@shotright.example'), 'the action is a real mailto link, not a scripted redirect')
const body = decodeURIComponent(href.split('&body=')[1] || '')
check(body.startsWith('Which part of the listing is the problem?'), 'the partner’s own words come first in the email')
check(/Reference: V-9/.test(body), 'and the venue reference travels with it, so the first reply isn’t “which venue?”')
check(/Declined on: /.test(body), 'along with when it was declined')
check(decodeURIComponent(href).includes('subject=Declined venue: Shisanyama on 4th'), 'with a subject that names the venue')

await context.close(); await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED` : '\nAll checks passed')
process.exit(fail.length ? 1 : 0)

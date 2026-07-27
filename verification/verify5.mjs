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

/**
 * A fake bench whose profile shape and write behaviour are configurable.
 *
 * `shape` decides which fields the profile comes back with. `accepts` decides
 * which of the posted kwargs the method actually stores — Frappe silently drops
 * the rest, which is precisely the failure being reproduced.
 */
async function bench({ shape, accepts }) {
  const state = { first_name: 'Thabo', last_name: 'Mokoena', business_name: 'Kota King', phone: '' }
  const posted = []

  const profile = () => {
    const base = { email: 'a@b.c', business_name: state.business_name, phone: state.phone }
    if (shape === 'first_last') return { ...base, first_name: state.first_name, last_name: state.last_name }
    if (shape === 'full_name') return { ...base, full_name: `${state.first_name} ${state.last_name}`.trim() }
    return { ...base, vendor_name: `${state.first_name} ${state.last_name}`.trim() }
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (e) => console.log('   PAGEERROR', e.message))
  await page.route('**/api/**', (r) => {
    const u = new URL(r.request().url())
    if (u.pathname.startsWith('/api/resource/Mood')) return r.fulfill({ json: { data: [] } })
    if (u.pathname.includes('api.login'))
      return r.fulfill({ json: { message: { api_key: 'K', api_secret: 'S' } } })

    if (u.pathname.includes('update_vendor_profile')) {
      const body = JSON.parse(r.request().postData() || '{}')
      posted.push(body)
      // Store ONLY what this bench declares — everything else is dropped, 200.
      // `state` is always first/last internally, so a bench that accepts
      // `vendor_name` splits it, mirroring what a real one would do.
      for (const key of accepts) {
        if (body[key] === undefined) continue
        if (key === 'vendor_name') {
          const parts = String(body.vendor_name).trim().split(/\s+/)
          state.first_name = parts[0] || ''
          state.last_name = parts.slice(1).join(' ')
        } else {
          state[key] = body[key]
        }
      }
      return r.fulfill({ json: { message: { ok: true } } })
    }

    if (u.pathname.includes('get_vendor_dashboard'))
      return r.fulfill({ json: { message: { profile: profile(), stats: {}, venues: [] } } })

    return r.fulfill({ status: 404, json: { exc_type: 'DoesNotExistError' } })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill('a@b.c')
  await page.getByLabel('Password').fill('x')
  await page.getByRole('button', { name: 'Login' }).click()
  await page.getByText('Your venues').waitFor({ timeout: 15000 })
  return { page, posted, state }
}

/* ===== 1. bench stores first_name/last_name (the suspected real shape) ===== */
{
  const { page, posted, state } = await bench({
    shape: 'first_last',
    accepts: ['first_name', 'last_name', 'business_name', 'phone'],
  })

  // The reported symptom: the profile shows no name.
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  const nameField = page.getByLabel('Your name')
  check(
    (await nameField.inputValue()) === 'Thabo Mokoena',
    `name renders from first_name/last_name (got "${await nameField.inputValue()}")`,
  )

  const dash = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }).then(async () => {
    await page.getByText(/Welcome back/).waitFor()
    return page.locator('main').innerText()
  })
  check(dash.includes('Welcome back, Thabo'), 'dashboard greets by name, not "Welcome back, Vendor"')
  check(dash.includes('Thabo Mokoena'), 'profile summary shows the contact name')

  // The other symptom: editing does not persist.
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await nameField.fill('Lerato Dlamini')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText('Profile updated.').waitFor({ timeout: 10000 })

  const sent = posted[posted.length - 1]
  check(
    sent.first_name === 'Lerato' && sent.last_name === 'Dlamini',
    `the name is sent split as first/last (sent: ${JSON.stringify(sent)})`,
  )
  check(
    sent.vendor_name === undefined && sent.full_name === undefined,
    `nothing outside the real signature is sent (sent: ${JSON.stringify(sent)})`,
  )
  check(
    sent.phone === undefined,
    'phone is NOT sent — update_vendor_profile has no such parameter',
  )
  check(
    Object.keys(sent).every((k) =>
      ['first_name', 'last_name', 'business_name', 'new_password'].includes(k),
    ),
    `every key posted is one the method declares (${Object.keys(sent).join(', ')})`,
  )
  check(state.first_name === 'Lerato', 'the bench actually stored it')

  await page.reload({ waitUntil: 'networkidle' })
  check(
    (await page.getByLabel('Your name').inputValue()) === 'Lerato Dlamini',
    'and it survives a reload — it persists',
  )
  await page.close()
}

/* ===== 2. read tolerance: a bench whose dashboard sends vendor_name ===== */
{
  const { page, state } = await bench({
    shape: 'vendor_name',
    accepts: ['first_name', 'last_name', 'business_name'],
  })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  check(
    (await page.getByLabel('Your name').inputValue()) === 'Thabo Mokoena',
    'a dashboard payload using vendor_name still reads correctly',
  )
  await page.getByLabel('Your name').fill('Naledi Khumalo')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText('Profile updated.').waitFor({ timeout: 10000 })
  check(state.first_name === 'Naledi', 'and still saves via first_name/last_name')
  await page.close()
}

/* ===== 3. bench uses full_name ===== */
{
  const { page } = await bench({ shape: 'full_name', accepts: ['first_name', 'last_name'] })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  check(
    (await page.getByLabel('Your name').inputValue()) === 'Thabo Mokoena',
    'full_name shape reads correctly too',
  )
  await page.close()
}

/* ===== 4. bench SILENTLY IGNORES the write — the UI must not claim success ===== */
{
  const { page } = await bench({ shape: 'first_last', accepts: [] }) // stores nothing, returns 200
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await page.getByLabel('Your name').fill('Lerato Dlamini')
  await page.getByRole('button', { name: 'Save changes' }).click()

  await page.getByText(/did not stick/).waitFor({ timeout: 10000 })
  const body = await page.locator('main').innerText()
  check(true, 'a silent no-op is reported instead of "Profile updated."')
  check(!body.includes('Profile updated.'), 'and success is NOT also shown')
  check(
    body.includes('your name'),
    'the message names the field that failed, not just "something went wrong"',
  )
  check(
    (await page.getByLabel('Your name').inputValue()) === 'Thabo Mokoena',
    'the form snaps back to the truth rather than showing a value nobody has',
  )
  await page.close()
}

/* ===== 4b. phone has no home on the bench, so it must not look editable ===== */
{
  const { page } = await bench({
    shape: 'first_last',
    accepts: ['first_name', 'last_name', 'business_name'],
  })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  const phone = page.getByLabel('Phone')
  check(await phone.isDisabled(), 'phone is read-only — the API has no phone parameter')
  check(
    (await page.locator('main').innerText()).includes('Not editable here yet'),
    'and says so, rather than silently discarding what is typed',
  )
  await page.close()
}

/* ===== 5. partial: business_name saves, name does not ===== */
{
  const { page } = await bench({ shape: 'first_last', accepts: ['business_name', 'phone'] })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await page.getByLabel('Your name').fill('Lerato Dlamini')
  await page.getByLabel('Business name').fill('Rooftop Co')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByText(/did not stick/).waitFor({ timeout: 10000 })
  const body = await page.locator('main').innerText()
  check(
    body.includes('your name') && !body.includes('business name did not'),
    'only the field that failed is named',
  )
  check(
    (await page.getByLabel('Business name').inputValue()) === 'Rooftop Co',
    'the field that DID save keeps its new value',
  )
  await page.close()
}

/* ===== 6. a background refetch must not wipe what is being typed ===== */
{
  const { page } = await bench({
    shape: 'first_last',
    accepts: ['first_name', 'last_name', 'business_name', 'phone'],
  })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  await page.getByLabel('Your name').fill('Half typed nam')

  // TanStack Query refetches on window focus; simulate the blur/focus round trip.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await page.waitForTimeout(800)
  check(
    (await page.getByLabel('Your name').inputValue()) === 'Half typed nam',
    'alt-tabbing away and back does not wipe the form mid-edit',
  )
  await page.close()
}

/* ===== 7. password fields got the show/hide control here too ===== */
{
  const { page } = await bench({ shape: 'first_last', accepts: ['first_name'] })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
  const toggles = page.getByRole('button', { name: /^(show|hide)$/i })
  check((await toggles.count()) === 2, 'both password fields have a show/hide control')
  await page.screenshot({ path: 'profile.png', fullPage: true })
  await page.close()
}

await browser.close()
console.log(fail.length ? `\n${fail.length} FAILED:\n - ` + fail.join('\n - ') : '\nAll checks passed.')
process.exit(fail.length ? 1 : 0)

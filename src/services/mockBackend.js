/**
 * In-memory stand-in for the Frappe backend — LOCAL DEVELOPMENT ONLY.
 *
 * ⚠️ Nothing in this file is real. The venues, profile and menus below are
 * invented and must never reach a partner. They once did: the Vercel
 * deployment carried `VITE_USE_MOCKS=true`, so partners were shown these
 * venues as though they were their own, with nothing on screen to say so.
 *
 * Two things prevent a repeat. `USE_MOCKS` in `api.js` is gated on
 * `import.meta.env.DEV`, so no deployed build selects this path whatever the
 * hosting dashboard says; and `assertDev()` below makes an accidental call
 * fail loudly instead of quietly returning fiction. The fixtures do still ship
 * in the production bundle — they are dead weight, not a live path — which is
 * why the runtime guard is here and not only in `api.js`.
 *
 * The shapes mirror the real `shotright.api.*` responses so the two paths stay
 * interchangeable while working offline.
 */
import { matchMood, FALLBACK_MOODS as MOODS } from './moods'

/**
 * A fixture call in a production build is a bug, not a fallback. Throwing means
 * it surfaces as a visible error the first time it happens, rather than as
 * plausible-looking data nobody thinks to question.
 */
const assertDev = () => {
  if (!import.meta.env.DEV) {
    throw new Error(
      'mockBackend was called in a production build. Fixtures are dev-only — ' +
        'this is a wiring bug, not a backend outage.',
    )
  }
}

const delay = (ms = 220) => {
  assertDev()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const DAYS =['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const db = {
  user: null,
  vendorProfile: {
    name: 'VP-0001',
    vendor_name: 'Demo Vendor',
    business_name: 'Daystar Hospitality Group',
    email: 'vendor@shotright.co.za',
    phone: '+27 82 000 0000',
  },
  venues: [
    {
      name: 'VEN-0001',
      venue_name: 'The Rooftop, Braamfontein',
      vendor_profile: 'VP-0001',
      workflow_state: 'Approved',
      dress_code: 'Smart casual',
      atmosphere_desc: 'Sunset views over the CBD with a resident DJ from 6pm.',
      address: '70 Juta St, Braamfontein, Johannesburg',
      latitude: -26.1929,
      longitude: 28.0305,
      moods: ['MOOD-CHILLED', 'MOOD-CLASSY'],
      operating_hours: DAYS.map((day) => ({
        day_of_week: day,
        open_time: '16:00',
        close_time: '23:00',
        closed: day === 'Monday',
      })),
    },
    {
      name: 'VEN-0002',
      venue_name: 'Kota King, Soweto',
      vendor_profile: 'VP-0001',
      workflow_state: 'Pending',
      dress_code: 'Casual',
      atmosphere_desc: 'Loud, busy and family-friendly. Best kota in Vilakazi.',
      address: 'Vilakazi St, Orlando West, Soweto',
      latitude: -26.2374,
      longitude: 27.9077,
      moods: ['MOOD-FAMILY', 'MOOD-TURNT'],
      operating_hours: DAYS.map((day) => ({
        day_of_week: day,
        open_time: '09:00',
        close_time: '21:00',
        closed: false,
      })),
    },
  ],
  headings: [
    { name: 'PH-0001', venue: 'VEN-0001', heading: 'Cocktails', idx: 1 },
    { name: 'PH-0002', venue: 'VEN-0001', heading: 'Small Plates', idx: 2 },
  ],
  items: [
    { name: 'PI-0001', product_heading: 'PH-0001', item_name: 'Espresso Martini', price: 95, description: '' },
    { name: 'PI-0002', product_heading: 'PH-0001', item_name: 'Amarula Colada', price: 88, description: '' },
    { name: 'PI-0003', product_heading: 'PH-0002', item_name: 'Chilli Poppers', price: 65, description: '6 pieces' },
  ],
}

let seq = 100
const nextId = (prefix) => `${prefix}-${String(++seq).padStart(4, '0')}`

export const mockBackend = {
  async login({ usr, pwd }) {
    await delay()
    if (!usr || !pwd) throw new Error('Please enter your email and password.')
    // Any non-empty credentials pass in mock mode — real validation is the
    // Auth Token Service's job (#14).
    db.user = { email: usr, full_name: db.vendorProfile.vendor_name }
    return { user: db.user, vendor_profile: db.vendorProfile }
  },

  async register({ email, password, vendor_name, business_name }) {
    await delay()
    if (!email || !password) throw new Error('Email and password are required.')
    db.vendorProfile = {
      ...db.vendorProfile,
      vendor_name: vendor_name || 'New Vendor',
      business_name: business_name || '',
      email,
    }
    db.user = { email, full_name: db.vendorProfile.vendor_name }
    return { user: db.user, vendor_profile: db.vendorProfile }
  },

  async logout() {
    await delay(80)
    db.user = null
    return { ok: true }
  },

  async getLoggedUser() {
    await delay(80)
    if (!db.user) throw Object.assign(new Error('Not permitted'), { status: 403 })
    return { user: db.user, vendor_profile: db.vendorProfile }
  },

  async getMoods() {
    await delay(80)
    return MOODS
  },

  /**
   * Stand-in for Frappe's upload_file (C4 — images live on the bench).
   *
   * Returns the same shape the real endpoint does, so callers only ever read
   * `file_url`. Here that URL is an object URL valid for this page session;
   * on the bench it is a real, servable path.
   */
  async uploadMenuImage(file) {
    await delay(400)
    if (!file.type.startsWith('image/')) throw new Error('That file is not an image.')
    if (file.size > 5 * 1024 * 1024) throw new Error('Images must be under 5MB.')
    return { file_url: URL.createObjectURL(file), file_name: file.name }
  },

  /**
   * Resolve one partner-typed mood against the fixtures.
   *
   * Delegates to the shared matcher so dev behaves exactly like production —
   * only the list differs. The Mood Suggestion branch that used to live here is
   * gone: it invented an id and reported success for something no backend can
   * store, which is the failure mode the mock existed to avoid.
   */
  async resolveMood(text) {
    await delay(120)
    return matchMood(MOODS, text)
  },

  async getDashboard() {
    await delay()
    const venues = db.venues
    return {
      profile: db.vendorProfile,
      stats: {
        total: venues.length,
        approved: venues.filter((v) => v.workflow_state === 'Approved').length,
        pending: venues.filter((v) => v.workflow_state === 'Pending').length,
        rejected: venues.filter((v) => v.workflow_state === 'Rejected').length,
      },
      venues: venues.map((v) => ({
        name: v.name,
        venue_name: v.venue_name,
        workflow_state: v.workflow_state,
        address: v.address,
      })),
    }
  },

  async getVenues() {
    await delay()
    return db.venues.map((v) => ({ ...v }))
  },

  async getVenue(venueId) {
    await delay()
    const venue = db.venues.find((v) => v.name === venueId)
    if (!venue) throw new Error(`Venue ${venueId} not found.`)
    return { ...venue }
  },

  async createVenue(payload) {
    await delay(320)
    const venue = {
      ...payload,
      name: nextId('VEN'),
      vendor_profile: db.vendorProfile.name,
      // Every vendor-created venue enters review, never live (#15).
      workflow_state: 'Pending',
    }
    db.venues.push(venue)
    return { ...venue }
  },

  async updateVenue(venueId, payload) {
    await delay(320)
    const index = db.venues.findIndex((v) => v.name === venueId)
    if (index === -1) throw new Error(`Venue ${venueId} not found.`)
    // Editing an approved venue sends it back for re-approval.
    db.venues[index] = { ...db.venues[index], ...payload, workflow_state: 'Pending' }
    return { ...db.venues[index] }
  },

  async getMenu(venueId) {
    await delay()
    return db.headings
      .filter((h) => h.venue === venueId)
      .sort((a, b) => a.idx - b.idx)
      .map((h) => ({
        ...h,
        items: db.items.filter((i) => i.product_heading === h.name).map((i) => ({ ...i })),
      }))
  },

  async createHeading(venueId, heading) {
    await delay(180)
    const row = {
      name: nextId('PH'),
      venue: venueId,
      heading,
      idx: db.headings.filter((h) => h.venue === venueId).length + 1,
    }
    db.headings.push(row)
    return { ...row }
  },

  async createItem(headingId, payload) {
    await delay(180)
    const row = { name: nextId('PI'), product_heading: headingId, ...payload }
    db.items.push(row)
    return { ...row }
  },

  async deleteItem(itemId) {
    await delay(140)
    const index = db.items.findIndex((i) => i.name === itemId)
    if (index !== -1) db.items.splice(index, 1)
    return { ok: true }
  },

  async importMenu(venueId, rows) {
    await delay(420)
    let created = 0
    for (const row of rows) {
      let heading = db.headings.find((h) => h.venue === venueId && h.heading === row.heading)
      if (!heading) heading = await this.createHeading(venueId, row.heading)
      db.items.push({
        name: nextId('PI'),
        product_heading: heading.name,
        item_name: row.item_name,
        price: row.price,
        description: row.description || '',
      })
      created += 1
    }
    return { created }
  },

  async getProfile() {
    await delay(120)
    return { ...db.vendorProfile }
  },

  async updateProfile(payload) {
    await delay(260)
    const { new_password, ...fields } = payload
    db.vendorProfile = { ...db.vendorProfile, ...fields }
    return { ...db.vendorProfile }
  },
}

export { DAYS }

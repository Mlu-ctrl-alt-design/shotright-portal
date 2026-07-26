/**
 * In-memory stand-in for the Frappe backend.
 *
 * The Sho't Right doctypes (Vendor Profile, Venue, Venue Operating Hours,
 * Product Heading, Product Item) do not exist on the bench yet — issues #14,
 * #15 and #17 introduce them. This module lets the whole portal be built and
 * demoed now, and mirrors the exact shapes the real endpoints will return so
 * swapping `VITE_USE_MOCKS=false` is the only change needed later.
 *
 * Single swap-point, deliberately mirroring `lib/src/data/mock_data.dart` in
 * the Flutter customer app.
 */

const delay = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Mood master (#20), Desk-managed.
 *
 * Conflict C1 was resolved in favour of "free text that creates suggestions":
 * a partner types whatever they like, and the backend either resolves it onto a
 * canonical Mood or records a Mood Suggestion for staff to merge. That keeps the
 * partner experience in the designs while keeping customer-facing search clean.
 *
 * `aliases` is what makes the resolution useful — "boys night" and "bn out" both
 * land on the canonical "Boys Night Out" instead of fragmenting the taxonomy.
 * Canonical names are seeded from the moods that appear in the design frames.
 */
const MOODS = [
  { name: 'MOOD-CHILLED', mood_name: 'Chilled Bar', aliases: ['chilled', 'chill', 'chilled bar'] },
  { name: 'MOOD-BOYS', mood_name: 'Boys Night Out', aliases: ['boys night', 'boys', 'bn out'] },
  { name: 'MOOD-GIRLS', mood_name: 'Girls Night Out', aliases: ['girls night', 'girls'] },
  { name: 'MOOD-SPECIAL', mood_name: 'Special Occasion', aliases: ['special', 'occasion'] },
  { name: 'MOOD-KIDDIES', mood_name: 'Kiddies Birthday', aliases: ['kiddies', 'kids birthday'] },
  { name: 'MOOD-MOTHERS', mood_name: 'Mothers Day', aliases: ['mothers', "mother's day"] },
  { name: 'MOOD-ROOFTOP', mood_name: 'Rooftop', aliases: ['roof top', 'roof'] },
  { name: 'MOOD-OUTDOOR', mood_name: 'Outdoor', aliases: ['out door', 'outdoors'] },
  { name: 'MOOD-LOCAL', mood_name: 'Local Lit', aliases: ['local', 'lit'] },
  { name: 'MOOD-NEWINTOWN', mood_name: 'New In Town', aliases: ['new in town', 'newintown'] },
  { name: 'MOOD-ROMANTIC', mood_name: 'Romantic', aliases: ['romance', 'date night'] },
  { name: 'MOOD-FAMILY', mood_name: 'Family', aliases: ['family friendly', 'families'] },
  { name: 'MOOD-CLASSY', mood_name: 'Classy', aliases: ['upmarket', 'fancy'] },
  { name: 'MOOD-SPORTY', mood_name: 'Sports', aliases: ['sport', 'sports bar', 'game day'] },
]

/** Lowercase, collapse whitespace, drop punctuation — the comparison key. */
export const normaliseMood = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const db = {
  user: null,
  // Partner-typed moods awaiting a Desk decision (C1).
  moodSuggestions: [],
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
   * Dropdown data for wizard step 2. Both lists are Desk-managed on the real
   * bench (Frappe Link fields), so they are fetched rather than hard-coded in
   * the view — staff can extend them without a portal release.
   *
   * Seeded from the values in `venue details filled.png` and the review screen:
   * "Formal Wear" and "Out door laid back".
   */
  async getVenueLookups() {
    await delay(80)
    return {
      dress_codes: [
        'Formal Wear',
        'Smart Casual',
        'Casual',
        'Traditional',
        'Sports Wear',
        'No Dress Code',
      ],
      atmospheres: [
        'Out door laid back',
        'Fine dining',
        'Family friendly',
        'Lively and loud',
        'Quiet and intimate',
        'Sports bar',
      ],
    }
  },

  /**
   * Resolve one partner-typed mood (C1).
   *
   * Exact hit on a canonical name or alias links straight to that Mood.
   * Anything else becomes a Mood Suggestion the Desk can later merge or
   * approve — the venue still gets linked to it so the partner is never
   * blocked, but it does not reach customer search until staff act.
   *
   * `near` carries the closest canonical match back to the UI so the portal can
   * nudge ("did you mean Boys Night Out?") rather than silently fragmenting.
   */
  async resolveMood(text) {
    await delay(120)
    const key = normaliseMood(text)
    if (!key) throw new Error('Please type a mood first.')

    const canonical = MOODS.find(
      (m) => normaliseMood(m.mood_name) === key || (m.aliases || []).some((a) => normaliseMood(a) === key),
    )
    if (canonical) {
      return { status: 'canonical', mood: canonical.name, label: canonical.mood_name }
    }

    // Cheap containment check — enough to catch "boys night out party".
    const near = MOODS.find((m) => {
      const canonicalKey = normaliseMood(m.mood_name)
      return canonicalKey.includes(key) || key.includes(canonicalKey)
    })

    const existing = db.moodSuggestions.find((s) => normaliseMood(s.suggested_name) === key)
    const suggestion =
      existing ||
      (() => {
        const created = {
          name: `MOOD-SUG-${String(db.moodSuggestions.length + 1).padStart(4, '0')}`,
          suggested_name: String(text).trim(),
          status: 'Pending Review',
          vendor_profile: db.vendorProfile.name,
        }
        db.moodSuggestions.push(created)
        return created
      })()

    return {
      status: 'suggested',
      mood: suggestion.name,
      label: suggestion.suggested_name,
      near: near ? { mood: near.name, label: near.mood_name } : null,
    }
  },

  async getMoodSuggestions() {
    await delay(60)
    return db.moodSuggestions
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

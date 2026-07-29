/**
 * A fake Frappe bench, with Frappe's habits.
 *
 * This is state, not a pile of canned responses, because most of the bugs worth
 * catching on this project are about whether a WRITE actually landed. A stub
 * that returns a fixed venue can never fail the assertion "and then the name
 * was different"; this one can, and has.
 *
 * The habits it copies are the ones that have cost us:
 *
 *  - **Undeclared kwargs are dropped silently, at HTTP 200.** `call()` filters
 *    to the declared signature. A field the method doesn't know about does not
 *    error, it just doesn't happen. Four production bugs.
 *  - **A missing METHOD and a missing DOCUMENT are both 404 `DoesNotExistError`.**
 *    Only the exception text distinguishes them.
 *  - **Messages are HTML.** `frappe.throw` takes markup and it arrives in
 *    `_server_messages` verbatim.
 *  - **`update_venue` refuses unknown fields** rather than ignoring them, unlike
 *    everything else. Both behaviours are modelled because both are real.
 *
 * `bench` is mutated by tests before rendering — `bench.deploy.get_venue_photos
 * = false`, `bench.venues.push(...)` — and reset between them.
 */

const DEFAULT_PROFILE = {
  email: 'thabo@cornerkitchen.co.za',
  first_name: 'Thabo',
  last_name: 'Mokoena',
  vendor_name: 'Thabo Mokoena',
  business_name: 'Corner Kitchen Group',
  phone: '+27 82 000 0000',
}

export const VENUE_ONE = {
  name: 'VEN-00001',
  venue_name: 'Corner Kitchen & Bar',
  address: '12 Long St, Cape Town',
  latitude: -33.9249,
  longitude: 18.4241,
  dress_code: 'Smart casual',
  atmosphere_desc: 'Loud, warm, good for a long table.',
  workflow_state: 'Approved',
  moods: ['MOOD-CHILLED'],
  operating_hours: [
    { day_of_week: 'Monday', open_time: '17:00', close_time: '23:00', closed: 0 },
    { day_of_week: 'Tuesday', open_time: '17:00', close_time: '23:00', closed: 0 },
  ],
}

const initial = () => ({
  /** Which methods exist. Flip to false to model "not deployed yet". */
  deploy: {
    login: true,
    register_vendor: true,
    get_vendor_dashboard: true,
    get_venue_detail: true,
    create_venue: true,
    update_venue: true,
    get_venue_products: true,
    add_product_heading: true,
    add_product_item: true,
    get_venue_photos: true,
    set_venue_photos: true,
    save_venue_draft: true,
    list_venue_drafts: true,
    get_venue_draft: true,
    discard_venue_draft: true,
    update_vendor_profile: true,
    resolve_mood: true,
    get_popular_moods: true,
    get_popular_venue_options: true,
    verify_otp: true,
    resend_otp: true,
    'frappe.client.delete': true,
    'frappe.client.get_list': true,
    'frappe.client.set_value': true,
    upload_file: true,
  },

  /** Registration path: true makes register_vendor return otp_required. */
  otpRequired: false,
  otpCode: '123456',

  /** Which kwargs each method actually declares. Anything else is DROPPED. */
  declared: {
    update_vendor_profile: ['first_name', 'last_name', 'business_name', 'phone', 'new_password'],
  },

  /**
   * `moods` is a child table on `Venue`, so `venue.update()` cannot take a list
   * of plain strings — see the handler. Production behaviour; set false to
   * model a bench that has been fixed.
   */
  moodsAreChildRows: true,

  /** Fields `get_venue_detail` leaves out that `get_vendor_dashboard` returns. */
  detailOmits: [],

  /** `update_venue` throws on unrecognised fields rather than dropping them. */
  venueWritable: [
    'venue_name',
    'address',
    'latitude',
    'longitude',
    'dress_code',
    'atmosphere_desc',
    'moods',
    'operating_hours',
    'new_name',
  ],

  session: null,
  users: [{ email: DEFAULT_PROFILE.email, password: 'correct-horse', enabled: true }],
  profile: { ...DEFAULT_PROFILE },
  venues: [structuredClone(VENUE_ONE)],
  moods: [
    { name: 'MOOD-CHILLED', mood_name: 'Chilled' },
    { name: 'MOOD-LIVELY', mood_name: 'Lively' },
    { name: 'MOOD-DATE', mood_name: 'Date night' },
  ],
  headings: [],
  items: [],
  photos: {},
  files: [],
  drafts: [],

  /** Every write the app made, in order. Tests assert on this. */
  calls: [],
})

export let bench = initial()

export function resetBench() {
  bench = initial()
}

/** The venue as the server holds it. Tests read this AFTER a UI save. */
export const venueById = (id) =>
  bench.venues.find((v) => v.name === id || v.venue_name === id)

export const headingsFor = (venueId) =>
  bench.headings
    .filter((h) => h.venue === venueId)
    .map((h) => ({
      ...h,
      items: bench.items.filter((i) => i.parent_heading === h.name),
    }))

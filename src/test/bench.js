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
    /* The whitelisted uploader that elevates internally. Live 22 Aug — this is
       what ended the dependency on stock Frappe endpoints. */
    upload_venue_photo: true,

    /* Shipped 7 Aug, so `true` is now the truthful default. The flag stays so a
       test can still put it back to false: partners' benches are updated at
       different times, and the "we can't see your bookings" path has to keep
       working for whoever is a release behind. */
    get_venue_bookings: true,

    /* False on purpose — these do not exist on the real bench yet, and the
       truthful default is what makes an opt-in test meaningful. */
    update_product_item: false,
    delete_product_item: false,

    /* Legal documents were announced on 7 Aug with no method name attached, so
       the portal is guessing at names. `true` here models the guess landing;
       tests that want the not-deployed path set them false. Both paths matter
       and both are covered. */
    get_legal_documents: true,
    accept_legal_document: true,

    /* The Places proxy. No method name has been agreed, so this models the
       guess landing; tests that want the wizard without it set them false. */
    search_places: true,
    get_place_details: true,
  },

  /** Registration path: true makes register_vendor return otp_required. */
  otpRequired: false,
  /** Login path: an unverified account answers with otp_required, not an error. */
  loginNeedsOtp: false,
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

  /**
   * How a venue's `moods` come back on a READ.
   *
   * `moods` is a child table, so what a serialiser hands back is a choice, not
   * a fact — and the two endpoints that describe a Venue need not make the same
   * one. Reported 8 Aug: an edit that could not be saved because the form
   * matched child rows against docnames, selected nothing, and then refused to
   * submit on its own "select at least one mood" rule.
   *
   *   'ids'    ['MOOD-CHILLED']                — what the form always assumed
   *   'rows'   [{mood: 'MOOD-CHILLED'}]        — child rows, as Frappe holds them
   *   'labels' ['Chilled']                     — serialised for humans
   */
  moodReadShape: 'ids',

  /**
   * Which field `list_venue_drafts` names the draft with.
   *
   * Reported 8 Aug: *"on the dashboard 'discard this draft' button is not
   * working."* A `frappe.get_all`-shaped listing returns the docname as `name`
   * and nothing called `draft_id` — and the portal read `draft_id || id`, so
   * the id came back **undefined**, `discardDraft` returned early on its own
   * `if (!id)` guard, and the button did nothing at all. Silently.
   *
   *   'draft_id' — what the contract in docs/RESUME-SETUP.md asks for
   *   'name'     — what Frappe gives you if nobody aliases it
   */
  draftIdField: 'draft_id',

  /**
   * `discard_venue_draft` answers 200 and deletes nothing.
   *
   * The other way that button can appear dead, and the house speciality: a
   * kwarg the method does not declare is dropped at 200, so the call
   * "succeeds", the list refetches, and the card is still there.
   */
  draftDiscardSilentlyFails: false,

  /**
   * `upload_file` refuses, 403.
   *
   * Reported 8 Aug against the live portal for venue photos, and the menu
   * importer goes through the SAME endpoint — which is how "the menu upload is
   * not working" turned out to be one report, not two.
   *
   * `'always'` refuses every upload. `'attached'` refuses only uploads carrying
   * a `doctype`/`docname`, which is what a missing **Venue** attach permission
   * looks like; the menu path sends neither, so it would still work. The
   * difference decides which permission is actually missing, and the portal has
   * to behave sanely under both.
   */
  uploadRefused: false,

  /**
   * The import itself fails AFTER the file arrived.
   *
   * The one case where a different file genuinely is the answer — and the
   * control case for the copy above: the fix must not become a way of never
   * telling someone their CSV is broken.
   */
  importFails: false,

  /**
   * Google Places, proxied through the bench.
   *
   * `places` is what a search returns. `placesDeployed` false models the whole
   * accelerator being absent, which must leave the wizard exactly as it is
   * today — no dead search box, nothing to explain.
   *
   * `placeClaimed` models the listing already belonging to another account:
   * a real answer, not an error, and the one that stops a restaurant's bookings
   * being split across two listings.
   */
  places: [],
  placeClaimed: false,

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
  /** Keyed by venue docname. Empty AND unreadable are different states. */
  bookings: {},

  /**
   * Legal documents, and whether this vendor has accepted each.
   *
   * Empty by default so the whole legal apparatus is invisible until a test
   * says otherwise — which also proves the shell, the wizard and the submit
   * path are unaffected on a bench with nothing to accept.
   */
  legal: [],

  /**
   * THE FAILURE THIS SUITE EXISTS FOR: accept returns 200 and writes nothing.
   *
   * Not hypothetical. Frappe drops kwargs a method does not declare, silently,
   * at HTTP 200 — this project has shipped six bugs of exactly that shape. On
   * a price field it costs a retype. On a consent record it puts "Accepted 7
   * August" on screen over an empty table, and the first time anyone looks for
   * that record will be a dispute.
   */
  legalAcceptSilentlyFails: false,
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

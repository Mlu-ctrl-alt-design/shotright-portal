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
  cover_image: '/files/corner-kitchen-cover.jpg',
  latitude: -33.9249,
  longitude: 18.4241,
  dress_code: 'Smart casual',
  /* ⚠️ The fieldname is UNCONFIRMED — the backend says the field is on `Venue`
     and has not said what it is called. `bench.spendField` renames it so the
     portal's resolution off the payload is tested rather than assumed, and
     `null` models a bench that does not carry it at all. */
  average_spend: 250,
  atmosphere_desc: 'Loud, warm, good for a long table.',
  workflow_state: 'Approved',
  moods: ['MOOD-CHILLED'],
  /* ⚠️ Frappe's ACTUAL wire format for a Time field, not a tidied-up version of
     it. A Time is serialised as `str(timedelta)`, which zero-pads the minutes
     and NOT the hour — so nine in the morning arrives as "9:00:00". This
     fixture used to say "17:00", a shape the bench never sends, and that is the
     whole reason a bug that blanked every morning opening time got through: the
     one venue in the fake world opened in the evening, in a format with nothing
     to trip over. Wednesday exists to keep a single-digit hour in the suite. */
  operating_hours: [
    { day_of_week: 'Monday', open_time: '17:00:00', close_time: '23:00:00', closed: 0 },
    { day_of_week: 'Tuesday', open_time: '17:00:00', close_time: '23:00:00', closed: 0 },
    { day_of_week: 'Wednesday', open_time: '9:00:00', close_time: '23:00:00', closed: 0 },
  ],
}

const initial = () => ({
  /**
   * Fields `update_venue` ACCEPTS and then does not store — Frappe's silent
   * discard of an undeclared kwarg, at HTTP 200. e.g. ['operating_hours'].
   */
  silentlyDrops: [],

  /**
   * Which parameter the menu importer declares for the uploaded file. The
   * portal does not know, so it tries `file_name`, `file_url` and `file` in
   * turn. `'none'` is an importer that takes none of them.
   */
  importerWants: 'file_name',

  /**
   * Which argument the Product Item methods declare. `item_id` is what the live
   * bench told us on 5 Sep; the others exist so the portal's search for the
   * right name is testable.
   */
  itemIdParam: 'item_id',

  /** Which key the venue payload carries for average spend; null for none. */
  spendField: 'average_spend',

  /** A venue name `create_venue` will refuse, for testing a bulk import. */
  createVenueRefuses: null,

  /** A venue name `save_venue_draft` will refuse, for the same reason. */
  draftSaveRefuses: null,

  /**
   * Which parameter `update_venue` declares for a new name.
   *
   * ⚠️ CONFIRMED 13 Sep, against the bench: it is `new_venue_name`, and the
   * default here used to be `new_name` — the FIRST candidate the portal tries.
   * So every rename test passed on the first attempt and the refuse-then-retry
   * path, which is the only path the live site ever takes, was never run.
   *
   * `new_venue_name` is the second candidate, so the default fixture now walks
   * the same road a partner does: `new_name` refused, retry, renamed. `null`
   * models a bench that cannot rename at all.
   */
  renameParam: 'new_venue_name',

  /**
   * How this bench reports a method that is not there. 'attribute-error' is
   * what shotright.thedaystar.co.za actually does (417); 'not-found' is the
   * 404 a bench answers when the module path itself does not resolve.
   */
  missingMethodStyle: 'attribute-error',

  /** Which methods exist. Flip to false to model "not deployed yet". */
  deploy: {
    login: true,
    /* Off: the live bench has never told the portal it has this, and until it
       does no sign-in button may appear. Flip it on to model one that does. */
    login_with_google: false,
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
    /* The only door into the review queue — live on the bench since 23 Aug. */
    submit_venue_for_review: true,
    list_venue_drafts: true,
    get_venue_draft: true,
    discard_venue_draft: true,
    update_vendor_profile: true,
    resolve_mood: true,
    get_popular_moods: true,
    get_popular_venue_options: true,
    verify_otp: true,
    /* ONE issuer for every purpose. There is no `resend_otp` and never was;
       the portal called one for weeks and got a 417 each time. */
    send_otp: true,
    reset_password_with_otp: true,
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

    /* ⚠️ 13 Sep — THE REAL NAMES, from the bench's own access log. The portal
       is no longer guessing: `get_required_consents` lists the active policies,
       `get_outstanding_consents` says which of them THIS user still owes, and
       `accept_terms` records one. The old keys named two methods that have
       never existed (`get_legal_documents`, `accept_legal_document`), so a
       test setting them false proved nothing about the live bench. */
    get_required_consents: true,
    get_outstanding_consents: true,
    accept_terms: true,

    /* The Places proxy. No method name has been agreed, so this models the
       guess landing; tests that want the wizard without it set them false. */
    search_places: true,
    get_place_details: true,

    /**
     * The URL importer — Facebook / Instagram / a venue's own website.
     *
     * ⚠️ FALSE, because it does not exist. It has not been written on the
     * bench at all, and the truthful default is what makes an opt-in test
     * meaningful: the add-venue screen must be correct on the bench partners
     * are actually using, which is one with no URL import.
     */
    import_venue_from_url: false,

    /**
     * The paywall, landed on the bench in PR #44.
     *
     * ⚠️ FALSE by default, and that default is load-bearing rather than lazy.
     * `get_entitlements` is not reachable over HTTP yet — gunicorn runs
     * `--preload` and has not been restarted — so "absent" is the state every
     * partner is in today, and it must resolve to EVERYTHING UNLOCKED. A suite
     * that defaulted this on would prove the locks work and never prove the
     * thing that actually matters: that a bench which cannot answer does not
     * lock a paying partner out. Set true, with `bench.entitlements`, to model
     * a bench that sells Pro.
     */
    /* Live since 18 Sep — the bench has been restarted and answers over HTTP.
       It was false while the endpoint was unreachable, which meant the suite
       only ever proved the fall-open path. */
    get_entitlements: true,
    start_subscription: false,
  },

  /**
   * What `get_entitlements` answers when it is deployed.
   *
   * Rows, not a plan name — the backend stores capabilities as data because the
   * Pro list went from three items to six while the screen was being designed.
   * `[]` is a FREE account with the paywall switched on, which is a different
   * state to the endpoint being absent, and the two must not be confused.
   */
  entitlements: {
    /* The LIVE response, copied from the bench 2026-09-19. The previous fixture
       was `{plan: 'free', features: []}` — a legitimate state, but one that
       exercises no real feature key, which is how three wrong keys survived a
       green suite. Every partner on the live site is grandfathered today, so
       that is what this defaults to. */
    features: [
      'booking_analytics',
      'menu_import',
      'venue_bulk_import',
      'venue_import_google',
      'venue_import_social',
      'venue_import_website',
    ],
    gated: [
      'booking_analytics',
      'menu_import',
      'venue_bulk_import',
      'venue_import_google',
      'venue_import_social',
      'venue_import_website',
    ],
    grandfathered: true,
    paywall_active: false,
    upgrade_available: false,
    subscription: null,
    management_url: null,
    plans: [],
  },

  /** Where `start_subscription` sends them. null models "no adapter yet". */
  checkoutUrl: null,

  /** URL → the payload a working social/website importer would return. */
  importedByUrl: {},

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
   * ⚠️ DEFAULT FLIPPED 5 Sep, on the backend's word and their own break-test.
   *
   * `update_venue` DOES take a list of bare mood names — `normalise_moods`
   * accepts a name, a `{mood: ...}` row or a JSON string, and throws on
   * anything else. The 28 Jul TypeError this modelled is history.
   *
   * Leaving it on was not neutral: every test in the suite ran against a bench
   * that crashed on the shape the real one accepts, so the portal's workaround
   * (drop moods, warn the partner) looked correct and moods have not saved on
   * an edit for weeks. Set true to model the old bench.
   */
  moodsAreChildRows: false,

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
    /* ⚠️ Writable ONLY because this bench is modelled as accepting it. On the
       real one that is unconfirmed: a field can sit on the doctype and still
       not be a parameter of the whitelisted method, and `update_venue` refuses
       an undeclared field by name rather than dropping it. Take this out to
       model that, and the partner should be told the average spend did not
       save — not left thinking it did. */
    'average_spend',
    'avg_spend',
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

  /** The live 417: the consent list exists and throws. */
  legalListRefuses: false,

  /** The documents live under the second candidate name instead. */
  legalListAltName: false,

  /**
   * ⚠️ 13 Sep — `get_outstanding_consents` cannot be reached.
   *
   * The portal must then mark NOTHING as accepted, because an unanswered
   * question is not a clean bill of health. Modelled separately from
   * `legalListRefuses` because the two halves fail independently on the bench:
   * the list is guest-readable, the outstanding call is user-scoped.
   */
  legalOutstandingRefuses: false,

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

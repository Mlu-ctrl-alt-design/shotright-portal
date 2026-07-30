/**
 * Vendor-facing API for the `shotright` Frappe app.
 *
 * Every call site the portal has is in this file, and each picks between the
 * real endpoint and an in-memory fixture of the same shape.
 *
 * ⚠️ `pick()` selects the fixture ONLY in a local dev build with
 * `VITE_USE_MOCKS=true`. A deployed build always takes the real branch — see
 * `USE_MOCKS` in `api.js`. It did not always work that way, and partners were
 * shown fixture venues in production as a result.
 *
 * The real surface is documented in the Postman collection for
 * shotright.thedaystar.co.za. Three things differ from what the portal UI was
 * built against, and are bridged or flagged here rather than hidden — see
 * `docs/BACKEND-INTEGRATION.md` for the full picture:
 *
 *   C1  the backend requires moods to already exist in the curated Mood list.
 *       There is no endpoint to create or suggest one, so partner-authored
 *       moods cannot currently be persisted.
 *   C3  the backend stores operating hours as per-day rows. The wizard collects
 *       three ranges, so `expandOperatingHours()` below converts.
 *   C4  `add_product_item` takes no image, so menu photos have nowhere to go.
 *   C5  nothing on the Venue holds the venue's own PHOTOGRAPHS — not on
 *       `create_venue`, not as an endpoint. The portal uploads them anyway and
 *       says plainly that they are not reaching customers yet; see the venue
 *       photos section below.
 *
 * Methods live in a flat `shotright.api.*` namespace — not `.vendor.*`.
 */
import api, {
  call,
  callGet,
  USE_MOCKS,
  setAuthToken,
  hasAuthToken,
  isMethodMissing,
} from './api'
import { mockBackend } from './mockBackend'
import { matchMood, FALLBACK_MOODS } from './moods'
import { VENUE_LOOKUPS } from './lookups'
import { normaliseProfile, toProfilePayload } from './profile'

const pick = (real, mock) => (USE_MOCKS ? mock : real)

/**
 * Run `real`, and fall back to `whenMissing` if the method is not deployed.
 *
 * The backend and this portal ship separately, and neither can wait for the
 * other. Rather than a feature flag someone has to remember to flip — which is
 * exactly how partners ended up looking at fixture venues — the portal asks the
 * bench what it can do and adapts.
 *
 * A missing whitelisted method is a 404 from Frappe. Anything else (403, 417, a
 * network failure, a real validation error) is a genuine error and is rethrown:
 * treating a permission failure as "feature absent" would silently downgrade
 * the product instead of reporting a misconfiguration.
 *
 * The verdict is cached per method for the tab, so a missing endpoint costs one
 * request rather than one per keystroke.
 */
const capabilities = new Map()

export async function withFallback(method, real, whenMissing) {
  if (capabilities.get(method) === false) return whenMissing()
  try {
    const result = await real()
    capabilities.set(method, true)
    return result
  } catch (err) {
    if (err?.status === 404) {
      capabilities.set(method, false)
      return whenMissing()
    }
    throw err
  }
}

/** Test seam — lets a test reset what the portal thinks the bench supports. */
export const __resetCapabilities = () => {
  capabilities.clear()
  photoSupport = null
}

/* --------------------------------------------------------------------- auth */

/**
 * Exchanges credentials for a reusable api_key/api_secret pair.
 *
 * ⚠️ 28 Jul — the same capability branch `register` has had since the OTP work,
 * missing here because at the time login could not return this shape.
 *
 * With verification live, a bench can answer login for an unverified account
 * with `{otp_required: true}` and NO token: the credentials were right, there
 * is just a step left. `setAuthToken` correctly refuses a response with no
 * api_key — but the store went on to set `status: 'authenticated'` anyway, so
 * the partner landed on a dashboard with nothing to authenticate with, and
 * every call behind it failed.
 *
 * Reported as "login goes straight through to the dashboard".
 */
export const login = (email, password) =>
  pick(
    async () => {
      const result = await call('shotright.api.login', { email, password })
      if (result?.otp_required) {
        return { otpRequired: true, email: result.email || email }
      }
      setAuthToken(result)
      return result
    },
    async () => {
      const result = await mockBackend.login({ usr: email, pwd: password })
      setAuthToken({ api_key: 'mock', api_secret: 'mock' })
      return result
    },
  )()

/**
 * Register returns a token in the same shape as login, so a new partner lands
 * straight in the portal without a second round trip.
 *
 * The backend takes first_name/last_name separately, which is what the register
 * form already collects — the earlier join into a single `vendor_name` is no
 * longer needed.
 */
export const register = ({ email, password, business_name, first_name, last_name }) =>
  pick(
    async () => {
      const result = await call('shotright.api.register_vendor', {
        email,
        password,
        business_name,
        first_name,
        last_name,
      })

      // CAPABILITY BRANCH. With email verification deployed, register_vendor
      // returns `{otp_required: true}` and no token — the account exists but is
      // disabled until a code is redeemed. Without it, register_vendor returns
      // a token exactly as before.
      //
      // Branching on the response rather than on a build flag means the two
      // sides ship in either order with no broken window, and no flag anyone
      // has to remember to flip.
      if (result?.otp_required) {
        return { otpRequired: true, email: result.email || email }
      }

      setAuthToken(result)
      return result
    },
    async () => {
      const result = await mockBackend.register({
        email,
        password,
        vendor_name: `${first_name} ${last_name}`.trim(),
        business_name,
      })
      setAuthToken({ api_key: 'mock', api_secret: 'mock' })
      return result
    },
  )()

/**
 * Redeem a registration code. Returns a token on success, same as login.
 *
 * Only reachable when `register` reported `otpRequired`, so there is no
 * fallback here — if this 404s the backend contract is genuinely broken and
 * pretending otherwise would strand a half-created account.
 */
export const verifyOtp = (email, code) =>
  pick(
    async () => {
      const result = await call('shotright.api.verify_otp', { email, code })
      setAuthToken(result)
      return result
    },
    async () => {
      // Dev fixtures accept 000000 so the screen can be worked on offline.
      if (String(code).trim() !== '000000') {
        throw new Error('That code is not correct. (Dev fixtures expect 000000.)')
      }
      setAuthToken({ api_key: 'mock', api_secret: 'mock' })
      return mockBackend.getLoggedUser()
    },
  )()

export const resendOtp = (email, purpose = 'Registration') =>
  pick(
    () => call('shotright.api.resend_otp', { email, purpose }),
    async () => ({ sent: true, cooldown_seconds: 60 }),
  )()

/**
 * Start a password reset.
 *
 * Deliberately reports success even for an address with no account — the
 * backend does the same. Anything else turns this form into a free tool for
 * checking whether a given email is registered on the platform.
 */
export const requestPasswordReset = (email) =>
  pick(
    () => call('shotright.api.request_password_reset', { email }),
    async () => ({ sent: true, cooldown_seconds: 60 }),
  )()

export const resetPassword = (email, code, new_password) =>
  pick(
    async () => {
      const result = await call('shotright.api.reset_password', {
        email,
        code,
        new_password,
      })
      setAuthToken(result)
      return result
    },
    async () => {
      if (String(code).trim() !== '000000') throw new Error('That code is not correct.')
      setAuthToken({ api_key: 'mock', api_secret: 'mock' })
      return mockBackend.getLoggedUser()
    },
  )()

/** Token auth has no server-side session to destroy — dropping it is the logout. */
export const logout = () =>
  pick(
    async () => {
      setAuthToken(null)
      return { ok: true }
    },
    async () => {
      setAuthToken(null)
      return mockBackend.logout()
    },
  )()

/**
 * There is no "who am I" endpoint. The dashboard is the cheapest authenticated
 * call that returns the profile, so it doubles as the session probe on reload:
 * if the stored token still works, we are logged in.
 *
 * The `hasAuthToken` check is not an optimisation. Without a token this fired
 * an unauthenticated dashboard request on every cold load of /login, and
 * treated ANY 200 as proof of a session — so a bench that answered without
 * erroring would bounce a signed-out visitor into the portal with no profile
 * behind them. No token means guest; that is answerable without a round trip.
 */
export const getSession = () =>
  pick(
    async () => {
      if (!hasAuthToken()) throw Object.assign(new Error('Not signed in'), { status: 401 })
      const dash = await call('shotright.api.get_vendor_dashboard')
      if (!dash?.profile) throw Object.assign(new Error('Not signed in'), { status: 401 })
      return { user: dash.profile.email, vendor_profile: dash.profile }
    },
    () => mockBackend.getLoggedUser(),
  )()

/* -------------------------------------------------------------------- moods */

/**
 * The curated Mood list.
 *
 * GAP: the collection still exposes no `get_moods` method, even though
 * `create_venue` requires every mood to already exist on that list. Rather than
 * stay pinned to fixtures — which let the portal offer a partner a mood the
 * bench would then reject, failing the whole submit — this reads the Mood
 * doctype through Frappe's generic resource API. That needs no new backend
 * code, only read permission for the Vendor role on Mood.
 *
 * If the read fails (no permission, doctype named differently, bench down) the
 * fixture list is used so the wizard still functions, and `sourceIsFallback` is
 * set so callers can say so rather than implying authority they don't have.
 * A dedicated endpoint is still the right fix — `backend/mood_suggestions.py`
 * has one ready. Tracked in docs/BACKEND-INTEGRATION.md.
 */
let moodListPromise = null

export const getMoods = () => {
  // Cached for the tab. `resolveMood` calls this per typed mood, and the bulk
  // CSV import calls it once per line — without this, importing a 200-row file
  // would fire 200 identical requests at the bench.
  moodListPromise ||= pick(
    async () => {
      try {
        const rows = await api
          .get('/api/resource/Mood', {
            params: { fields: JSON.stringify(['name', 'mood_name']), limit_page_length: 0 },
          })
          .then((r) => r.data.data)
        if (Array.isArray(rows) && rows.length) return rows
        throw new Error('Mood list came back empty')
      } catch (err) {
        console.warn(
          '[shotright] Could not read the live Mood list, falling back to the built-in list. ' +
            'Moods offered here may not exist on the bench. Cause:',
          err.message,
        )
        const fallback = FALLBACK_MOODS.map((m) => ({ ...m }))
        fallback.sourceIsFallback = true
        return fallback
      }
    },
    () => mockBackend.getMoods(),
  )()

  // A failed lookup must not poison the tab — clear the cache so the next
  // attempt retries rather than replaying the error forever.
  return moodListPromise.catch((err) => {
    moodListPromise = null
    throw err
  })
}

/**
 * Resolve one typed mood.
 *
 * Server-side when `resolve_mood` is deployed: text that matches the curated
 * list resolves onto it, and anything genuinely new is filed as a Mood
 * Suggestion for staff to review — the original C1 decision. The result then
 * carries `status: 'suggested'`, which the mood step renders as pending rather
 * than as a normal mood, because it is not searchable until approved.
 *
 * Client-side when it is not: matching against the list `getMoods()` returned,
 * and an unmatched mood comes back `status: 'unmatched'` and is refused at the
 * point of entry. Refusing is the honest degradation — `create_venue` rejects
 * moods it does not know, so accepting one would fail the whole submission four
 * steps later.
 *
 * Both shapes are handled by the caller. Do NOT collapse them: the difference
 * between "we filed this for review" and "we cannot take this" is exactly what
 * the partner needs to know.
 */
export const resolveMood = (text) =>
  pick(
    () =>
      withFallback(
        'resolve_mood',
        () => call('shotright.api.resolve_mood', { text }),
        async () => matchMood(await getMoods(), text),
      ),
    () => mockBackend.resolveMood(text),
  )()

/**
 * Moods most used by other approved venues, for onboarding smart defaults.
 *
 * A partner facing an empty mood field has to guess at a vocabulary they have
 * never been shown. This turns recall into recognition.
 *
 * Falls back to the head of the plain list — which is alphabetical, not
 * popular. That is a weaker hint but not a wrong one, and it keeps the
 * onboarding step working identically before and after the endpoint lands.
 */
export const getPopularMoods = (limit = 8) =>
  pick(
    () =>
      withFallback(
        'get_popular_moods',
        () => call('shotright.api.get_popular_moods', { limit }),
        async () => (await getMoods()).slice(0, limit).map((m) => ({ ...m, venue_count: 0 })),
      ),
    () => mockBackend.getPopularMoods(limit),
  )()

/**
 * GAP: no lookup endpoint for dress codes or atmospheres, and no doctype to
 * read generically — `atmosphere_desc` is free text on the bench, not a select.
 *
 * These are served from `lookups.js` in every environment. They are portal-side
 * vocabulary rather than partner data, so a local list misrepresents nothing;
 * see that file for why it is not part of the fixtures.
 */
export const getVenueLookups = async () => VENUE_LOOKUPS

/**
 * Aggregate popularity for the two dropdowns — the Tier C signal.
 *
 * Shape: `{dress_code: {value, share}, atmosphere: {value, share}}` where
 * `share` is a whole-number percentage shown to the partner as justification
 * ("Most venues pick this (62%)").
 *
 * NO ENDPOINT YET, so this resolves to `null` and the dropdowns render with no
 * default and no chip — which the spec (§9) already names as acceptable.
 *
 * It must NOT fall back to a plausible-looking guess. The share is displayed as
 * a reason to trust the suggestion, so an invented one is a fabricated
 * statistic put in front of partners. The spec's own §12 warns about the
 * feedback loop here: a pre-selected dropdown nobody reads poisons the
 * popularity figure it was derived from. Seeding that loop with a number we
 * made up would be worse still.
 */
export const getPopularVenueOptions = () =>
  pick(
    () =>
      withFallback(
        'get_popular_venue_options',
        () => call('shotright.api.get_popular_venue_options'),
        async () => null,
      ),
    async () => mockBackend.getPopularVenueOptions(),
  )()

/* ---------------------------------------------------------------- dashboard */

export const getDashboard = () =>
  pick(
    async () => {
      const dash = await call('shotright.api.get_vendor_dashboard')
      // Same normalisation as getProfile — the dashboard greets the partner by
      // name and would otherwise say "Welcome back, Vendor" forever.
      return dash ? { ...dash, profile: normaliseProfile(dash.profile) } : dash
    },
    async () => {
      const dash = await mockBackend.getDashboard()
      return { ...dash, profile: normaliseProfile(dash.profile) }
    },
  )()

/* ------------------------------------------------------------------- venues */

export const getVenues = () =>
  pick(
    async () => {
      const dash = await call('shotright.api.get_vendor_dashboard')
      return dash?.venues ?? []
    },
    () => mockBackend.getVenues(),
  )()

export const VENUE_DETAIL_METHOD = 'shotright.api.get_venue_detail'

/**
 * One venue.
 *
 * ⚠️ 28 Jul, from the live site: `get_venue_detail?venue_name=VEN-00002`
 * returns **404** while `get_vendor_dashboard` lists VEN-00002 in the same
 * session, signed in as the same partner. Every screen that opens a single
 * venue — edit, menu, photos, and the decline screen behind "See why" — died on
 * that 404 and told the partner their venue "isn't on the account you're signed
 * in with, or it has been removed". About a venue sitting in their own list,
 * one click behind them.
 *
 * THE VENUE WAS NEVER MISSING. We already had it: the dashboard returned it,
 * review notes and all. A second endpoint declining to repeat itself is not a
 * reason to tell someone their data is gone.
 *
 * So the dashboard row is the fallback now. Same record, same server. Detail is
 * still tried first because it may carry fields the list omits, and `_partial`
 * marks which one answered — so a screen needing a field the row doesn't have
 * can say "we couldn't load this bit" rather than render it as empty.
 *
 * Second time today the answer has been: look at what you already hold before
 * asking whether you're allowed to fetch it.
 */
/**
 * Fields the edit form cannot function without.
 *
 * ⚠️ REPORTED 28 Jul: "when I open a venue to edit it, the address does not
 * show even though I know I set it."
 *
 * `get_venue_detail` and `get_vendor_dashboard` are different serialisers over
 * the same doctype, and they do not return the same fields. The venue LIST
 * shows each venue's address, so we demonstrably have it — the edit form was
 * just asking the one endpoint that omits it, and then rendering the blank as
 * though the partner had never typed one.
 *
 * A partner who opens the form, sees an empty address and saves has now
 * genuinely erased it. So a gap here is not cosmetic.
 */
const VENUE_ESSENTIALS = ['address', 'latitude', 'longitude', 'moods', 'operating_hours']

const missingFrom = (venue) =>
  VENUE_ESSENTIALS.filter((f) => venue?.[f] === undefined || venue?.[f] === null)

const dashboardRow = async (venueId) => {
  const dash = await call('shotright.api.get_vendor_dashboard').catch(() => null)
  return (dash?.venues || []).find((v) => v?.name === venueId || v?.venue_name === venueId) || null
}

export const getVenue = (venueId) =>
  pick(
    async () => {
      let detail
      try {
        detail = await callGet(VENUE_DETAIL_METHOD, { venue_name: venueId })
      } catch (err) {
        // 403 is a real answer — this venue is not theirs. Say so, rather than
        // papering over it with a row we happen to be holding.
        if (err?.status === 403) throw err

        const row = await dashboardRow(venueId)
        if (row) return { ...row, _partial: true, _detailError: err }
        throw err
      }

      /**
       * Detail answered, but is it complete? Fill only the gaps, and only from
       * the same server — this is not a cache, it is the same venue described
       * twice. Detail always wins where it has an answer, including a
       * deliberate empty string; `null`/absent is what counts as "not told".
       *
       * The extra request costs one round trip on a form the partner is about
       * to spend two minutes in, and only when something is actually missing.
       */
      const gaps = missingFrom(detail)
      if (!gaps.length) return detail

      const row = await dashboardRow(venueId)
      if (!row) return detail

      const filled = { ...detail }
      for (const field of gaps) {
        if (row[field] !== undefined && row[field] !== null) filled[field] = row[field]
      }
      return filled
    },
    () => mockBackend.getVenue(venueId),
  )()

const DAY_NAMES = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
}

/**
 * C3 bridge — three ranges out of the wizard, per-day rows into the backend.
 *
 * The designs collect weekday / weekend / public-holiday hours, which is how
 * partners think about it; the backend stores one row per operating day. Each
 * selected day gets the weekend range if it falls in the weekend, otherwise the
 * weekday range. `weekendStartsFriday` moves that boundary, which is exactly
 * what that toggle is for.
 *
 * Public-holiday hours have nowhere to go — the backend has no concept of them.
 * They are returned separately so the caller can report the loss rather than
 * quietly discarding a value the partner deliberately set.
 */
export function expandOperatingHours(hours) {
  const weekendDays = hours.weekendStartsFriday ? ['fri', 'sat', 'sun'] : ['sat', 'sun']
  const rows = (hours.days || []).map((day) => {
    const range = weekendDays.includes(day) ? hours.weekend : hours.weekday
    return {
      day_of_week: DAY_NAMES[day],
      open_time: `${range.start}:00`,
      close_time: `${range.end}:00`,
    }
  })
  return { rows, droppedPublicHoliday: hours.publicHoliday }
}

/**
 * Create a venue from wizard state.
 *
 * Returns `{venue, warnings}` — `warnings` names anything the backend could not
 * accept, so the UI can tell the partner instead of pretending it saved.
 */
export const createVenue = (payload) =>
  pick(
    async () => {
      const warnings = []

      // Canonical moods go by label; the backend accepts a Mood docname or its
      // mood_name. Vendor-authored ones go by their Mood Suggestion docname.
      //
      // A `suggested` mood can only exist if `resolve_mood` ran server-side and
      // filed it, so it always has a real docname here. When that endpoint is
      // absent, unmatched moods are refused at entry and never reach this
      // payload — which is why there is no capability check on this branch.
      const canonical = (payload.moods || []).filter((m) => m.status === 'canonical')
      const suggested = (payload.moods || []).filter((m) => m.status === 'suggested')

      if (suggested.length) {
        // Not a failure — a state. The venue saves, the mood is attached, and
        // it starts working the moment staff approve it. Saying "could not be
        // saved" here (as this once did) would be wrong in the other direction.
        warnings.push(
          `${suggested.length} new mood${suggested.length === 1 ? '' : 's'} ` +
            `(${suggested.map((m) => m.label).join(', ')}) ${suggested.length === 1 ? 'is' : 'are'} ` +
            `with the Sho't Right team for review. Your venue is saved either way — ` +
            `${suggested.length === 1 ? 'that mood' : 'those moods'} will start bringing ` +
            `customers in once approved.`,
        )
      }

      const { rows, droppedPublicHoliday } = expandOperatingHours(payload.operating_hours || {})
      if (droppedPublicHoliday?.start) {
        warnings.push('Public holiday hours were not saved — the app does not store them yet.')
      }

      // Fields with no home on create_venue.
      if (payload.manager_name || payload.contact_number || payload.summary) {
        warnings.push(
          'Manager details, contact number and the venue description were not saved — ' +
            'the app has no fields for them yet.',
        )
      }

      // Coordinates are not optional in practice: find_venues is a radius
      // search, so a venue without them is invisible to customers. The wizard's
      // map picker makes this hard to hit, but a partner can still clear the
      // fields by hand, and a silent invisible listing is the worst outcome
      // here — worse than a noisy warning.
      if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
        warnings.push(
          'No map location was set, so this venue will not appear when customers search near ' +
            'them. Edit the venue and drop the pin to fix it.',
        )
      }

      const venue = await call('shotright.api.create_venue', {
        venue_name: payload.venue_name,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        dress_code: payload.dress_code,
        atmosphere_desc: payload.atmosphere,
        moods: [...canonical.map((m) => m.label), ...suggested.map((m) => m.mood)],
        operating_hours: rows,
      })

      // Menu is a separate set of calls; create_venue takes none of it.
      if (payload.menu?.length) {
        const flat = payload.menu.flatMap((c) =>
          c.items.map((i) => ({
            heading_name: c.heading,
            item_name: i.item_name,
            price: i.price,
            description: i.description,
          })),
        )
        if (flat.length) {
          await call('shotright.api.bulk_import_products', {
            venue_name: venue.name ?? venue.venue_name,
            rows: flat,
          })
        }
        if (payload.menu.some((c) => c.items.some((i) => i.image))) {
          warnings.push(
            'Menu item photos were not saved — the app has no image field on menu items yet.',
          )
        }
      }

      // Photos, like the menu, are their own call — and unlike the menu they
      // have nowhere to land yet (C5). Attempted regardless, because the day
      // the endpoint appears this starts working with no release.
      if (payload.photos?.length) {
        const count = payload.photos.length
        const result = await saveVenuePhotos(venue.name ?? venue.venue_name, payload.photos)
        if (!result?.saved) {
          const uploaded = `Your ${count === 1 ? 'photo was' : `${count} photos were`} uploaded`
          warnings.push(
            result?.mismatch
              ? // The endpoint answered and kept fewer than we sent. A different
                // failure from "not deployed", and it needs different words —
                // this one is a live mismatch somebody has to look at today.
                `${uploaded}, but the app only kept ${result.mismatch.stored} of ` +
                  `${result.mismatch.sent}. Nothing has been lost from your device or ours — ` +
                  `we’ve reported it and we’ll get the rest attached.`
              : `${uploaded} and ` +
                  `${result?.attached ? 'attached to this venue for our reviewers' : 'stored safely'}, ` +
                  `but they won’t appear to customers yet — the app has no field for a venue’s ` +
                  `pictures. Nothing has been lost, and they’ll show up as soon as that lands.`,
          )
        }
      }

      return { venue, warnings }
    },
    async () => ({ venue: await mockBackend.createVenue(payload), warnings: [] }),
  )()

/**
 * REPORTED: editing a venue's name doesn't stick.
 *
 * THE BUG, and it is ours. This used to be:
 *
 *     call('shotright.api.update_venue', { venue_name: venueId, ...payload })
 *
 * `venue_name` is the IDENTIFIER on every endpoint in this API — `get_venue_detail`
 * is called with the docname under exactly that key. But `payload` comes
 * straight off the edit form and carries the partner's NEW name under the same
 * key, and it spreads second, so it wins. Every rename therefore said "update
 * the venue called <the name that doesn't exist yet>" and never mentioned the
 * venue being edited at all.
 *
 * One key was doing two jobs — naming the venue and identifying it — and the
 * moment those two values differ, which is precisely when someone is renaming,
 * they collide.
 *
 * So the identifier is now built separately and cannot be overwritten, and a new
 * name travels under its own key. `new_name` is what `frappe.rename_doc` calls
 * it; `new_venue_name` is the other plausible spelling. Frappe silently drops
 * kwargs a method does not declare, so sending both costs nothing and whichever
 * the bench declares wins — the same alias technique the workflow states use.
 *
 * ⚠️ `update_venue` is ANOTHER name out of `backend/api_reference.py`, the file
 * that predates the real API. It has never been confirmed, and if a Venue is
 * autonamed from `venue_name` then renaming needs `frappe.rename_doc` and not a
 * field write at all. We cannot check from here. So this VERIFIES rather than
 * assumes — see below.
 */
const VENUE_WRITE_FIELDS = [
  'address',
  'latitude',
  'longitude',
  'dress_code',
  'atmosphere_desc',
  'moods',
  'operating_hours',
]

export const UPDATE_VENUE_METHOD = 'shotright.api.update_venue'

/**
 * Human labels for fields we may have to report as unsaved.
 * Anything not listed falls back to the raw name, which is ugly but honest.
 */
const FIELD_LABELS = {
  address: 'the address',
  latitude: 'the map pin',
  longitude: 'the map pin',
  dress_code: 'the dress code',
  atmosphere_desc: 'the description',
  moods: 'the moods',
  operating_hours: 'the opening hours',
  venue_name: 'the venue name',
}

/**
 * Fields the endpoint told us it will not accept.
 *
 * ⚠️ 28 Jul, from production. `update_venue` does NOT quietly drop kwargs it
 * doesn't declare — it validates and throws:
 *
 *   ValidationError: Cannot update field(s): address, cmd, new_name,
 *                    new_venue_name
 *
 * That breaks the assumption the rest of this file is built on. Everywhere else
 * on this bench, sending a field a method doesn't know about is a silent no-op,
 * which is why we send alias families and check afterwards. Here an extra key
 * doesn't get ignored, it takes the ENTIRE SAVE down with it — so a partner
 * editing their dress code lost the whole edit because we also offered a rename
 * the endpoint had no parameter for.
 *
 * Two of those four are our doing (`new_name`, `new_venue_name` — speculative
 * rename aliases). `cmd` is Frappe's own routing key leaking through the
 * backend's `**frappe.form_dict`, and we never sent it. `address` being refused
 * is the backend's to explain — a venue that cannot change its address is not
 * a venue anyone can maintain.
 *
 * The response is precise and parseable, so we use it: strip exactly what was
 * named, retry once, and report what could not be saved instead of failing the
 * lot. It self-heals the day the allow-list is fixed.
 */
const REFUSED_FIELDS = /Cannot update field\(s\):\s*([^"\\\n]+)/i

const parseRefused = (err) => {
  const text = `${err?.detail || ''} ${err?.message || ''}`
  const match = text.match(REFUSED_FIELDS)
  if (!match) return null
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

/**
 * Write, and if the endpoint names fields it won't take, drop those and retry.
 *
 * Returns the list it refused (empty if it took everything). Only one retry:
 * a server that refuses a second, different set is telling us something we
 * should surface rather than loop over.
 */
const writeVenue = async (body) => {
  try {
    await call(UPDATE_VENUE_METHOD, body)
    return []
  } catch (err) {
    const text = `${err?.message || ''} ${err?.detail || ''} ${err?.original?.response?.data?.exc || ''}`

    // A child table given a list of ids. Nothing was saved — the exception is
    // raised before the write — so everything else in the edit is still to do.
    if (CHILD_TABLE_CRASH.test(text)) {
      const offenders = Object.keys(body).filter((k) => isListOfStrings(body[k]))
      if (!offenders.length) throw err

      const retry = { ...body }
      for (const field of offenders) delete retry[field]
      if (!Object.keys(retry).filter((k) => k !== 'venue_name').length) return offenders

      await call(UPDATE_VENUE_METHOD, retry)
      return offenders
    }

    const refused = parseRefused(err)
    if (!refused?.length) throw err

    // `cmd` is Frappe's, not ours — it appears in the refusal list but not in
    // anything we sent, and filtering on what we actually hold keeps the
    // partner-facing message about their own edit.
    const ours = refused.filter((field) => field in body)
    if (!ours.length) throw err

    const retry = { ...body }
    for (const field of ours) delete retry[field]

    // Nothing left worth sending: the identifier alone changes nothing, and a
    // second call that can only no-op is noise.
    const meaningful = Object.keys(retry).filter((k) => k !== 'venue_name')
    if (!meaningful.length) return ours

    await call(UPDATE_VENUE_METHOD, retry)
    return ours
  }
}

/**
 * A list of ids sent into a Frappe CHILD TABLE.
 *
 * ⚠️ 28 Jul, from production, on every venue edit that touched moods:
 *
 *   File "shotright/venue_service.py", line 89, in update_venue
 *       venue.update(fields)
 *   File "frappe/model/base_document.py", line 321, in _init_child
 *       value["doctype"] = doctype
 *   TypeError: 'str' object does not support item assignment
 *
 * `moods` is a child table on `Venue`. `venue.update()` hands each row to
 * `_init_child`, which expects a dict and assigns into it — so a list of plain
 * strings raises before anything is saved, and the whole edit is lost.
 *
 * `create_venue` accepts mood ids as strings quite happily. `update_venue`
 * passes them straight to `venue.update` and does not. That asymmetry is the
 * bug and it belongs on the bench, so this is a workaround rather than a fix.
 *
 * WE DO NOT GUESS THE CHILD-ROW SHAPE. Sending `[{mood: id}]` would work if the
 * child field happens to be called `mood` — and if it is called anything else,
 * Frappe writes empty rows and reports success, which would silently erase a
 * venue's moods. That is strictly worse than not saving them. So: drop the
 * field, save the rest, and tell the partner exactly which part didn't land.
 */
const CHILD_TABLE_CRASH = /does not support item assignment|_init_child/i

const isListOfStrings = (value) =>
  Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')

/**
 * Say what didn't save, naming it.
 *
 * The rename aliases are excluded — a refused `new_name` is reported by the
 * read-back below as "still called X", which is the sentence that means
 * something to a partner. Listing the parameter names as well would be us
 * explaining our own plumbing to someone who wanted to change their address.
 */
const warnAboutRefused = (refused) => {
  const shown = (refused || []).filter((f) => f !== 'new_name' && f !== 'new_venue_name')
  if (!shown.length) return []

  const labels = [...new Set(shown.map((f) => FIELD_LABELS[f] || f))]
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`

  return [
    `Everything else was saved, but this app couldn’t update ${list} — the server won’t ` +
      `accept ${labels.length === 1 ? 'that change' : 'those changes'} yet. We’ve reported it.`,
  ]
}

/**
 * Did this field actually change?
 *
 * Deliberately shallow-but-ordered for arrays: a mood list is a set the partner
 * edits by clicking chips, and reordering it means nothing, but comparing by
 * JSON is honest about "I cannot tell" and errs toward sending. Sending a field
 * that didn't change is a wasted key; NOT sending one that did is data loss, so
 * the comparison leans the safe way.
 */
const same = (a, b) => {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a === '' && b == null) return true
  if (b === '' && a == null) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

/**
 * @param existing the venue as the SERVER holds it, used for two things: the
 *                 current name (which is not the docname), and working out what
 *                 the partner actually changed.
 */
export const updateVenue = async (venueId, payload, existing) => {
  if (USE_MOCKS) {
    const venue = await mockBackend.updateVenue(venueId, payload)
    return { venue, renamed: null, warnings: [] }
  }

  // Callers used to pass just the name. Both are accepted so a stale call site
  // degrades to "send everything" rather than crashing.
  const current = typeof existing === 'string' ? { venue_name: existing } : existing || null
  const currentName = current?.venue_name

  /**
   * `currentName` is the venue's name as the SERVER holds it, and it is not the
   * same thing as `venueId`.
   *
   * A Venue's docname may be `VEN-0001` while its `venue_name` is "Corner
   * Kitchen & Bar". Comparing what the partner typed against the docname would
   * make every ordinary save — changing a dress code, moving the pin — look
   * like a rename, and every one of those would then come back with "the name
   * didn't save". A false alarm on every edit is worse than the bug it is
   * guarding against, because people learn to click through warnings.
   *
   * Falls back to `venueId`, which is correct on a bench that autonames the
   * Venue from `venue_name`.
   */
  const known = String(currentName || venueId).trim()
  const wanted = String(payload.venue_name || '').trim()
  const renaming = Boolean(wanted) && wanted !== known

  /**
   * An explicit list, not `...payload`. The edit form spreads the whole venue
   * it loaded, which means `workflow_state` was going back up on every save —
   * the one field the create path is careful never to let a client set.
   *
   * AND ONLY WHAT CHANGED. This is the real fix for the child-table crash: an
   * edit to the dress code has no business sending the mood list, and while it
   * did, every single edit went through the one field the endpoint cannot
   * accept. Sending less is also just correct — it makes a save mean "this is
   * what I changed" rather than "here is the whole document again", which is
   * how `workflow_state` escaped in the first place.
   */
  const body = {}
  for (const field of VENUE_WRITE_FIELDS) {
    if (payload[field] === undefined) continue
    if (current && same(payload[field], current[field])) continue
    body[field] = payload[field]
  }
  if (renaming) {
    body.new_name = wanted
    body.new_venue_name = wanted
  }
  // Last, so nothing above can reach it.
  body.venue_name = venueId

  const refused = await writeVenue(body)

  if (!renaming) {
    return {
      venue: await getVenue(venueId),
      renamed: null,
      warnings: warnAboutRefused(refused),
    }
  }

  /**
   * Did the rename actually happen?
   *
   * A 200 from Frappe does not mean it saved what you sent — an undeclared
   * kwarg is discarded silently, so a rename the method has no parameter for
   * succeeds and does nothing. The only way to know is to look, and a partner
   * who is told their venue is now called something else, and it isn't, will
   * not find out until a customer can't find them.
   *
   * The venue may be reachable under EITHER id afterwards, so both are tried.
   */
  const [underNew, underOld] = await Promise.all([
    getVenue(wanted).catch(() => null),
    getVenue(venueId).catch(() => null),
  ])

  const venue = underNew || underOld
  const renamed = String(venue?.venue_name || '').trim() === wanted

  // Both things can be true at once — the rename bounced AND the address was
  // refused — and a partner needs to hear both. "Everything else was saved" is
  // said once, by whichever message goes first, rather than twice.
  const refusedWarnings = warnAboutRefused(refused)
  const renameWarning = renamed
    ? null
    : `The venue is still called “${venue?.venue_name || venueId}”. ` +
      // Said here only when nothing else is being reported, so a partner with
      // two problems doesn't read "everything else was saved" twice and have to
      // work out which "everything else" each one meant.
      (refusedWarnings.length ? '' : 'Everything else you changed was saved — but ') +
      `this app can’t rename a venue yet, so that part didn’t take. We’ve reported it.`

  return {
    venue,
    renamed,
    warnings: [renameWarning, ...refusedWarnings].filter(Boolean),
  }
}

/* --------------------------------------------------------------------- menu */

/**
 * REPORTED: opening a venue's menu returned "Not found".
 *
 * A 404 here has two completely different causes and they were being shown to
 * the partner identically, as a red error where their menu should be:
 *
 *   THE ENDPOINT IS NOT DEPLOYED. `get_venue_products` is one of the method
 *   names that predate the real API — the same class of mistake that produced
 *   the `vendor_name` and `Rejected` bugs. Nothing is wrong with the partner's
 *   venue; the portal is asking for something that is not there.
 *
 *   THE VENUE IS NOT THEIRS, or does not exist. That is a real error and must
 *   still be reported as one.
 *
 * So this returns `{ headings, unavailable }` rather than throwing on the first
 * case. The page then renders — the partner can still add headings and items by
 * hand — with a banner that says which endpoint is missing, instead of a dead
 * end that reads as "we lost your menu".
 */
export const MENU_READ_METHOD = 'shotright.api.get_venue_products'

export const getMenu = async (venueId) => {
  if (USE_MOCKS) return { headings: await mockBackend.getMenu(venueId), unavailable: false }
  try {
    const headings = await callGet(MENU_READ_METHOD, { venue_name: venueId })
    return { headings: headings || [], unavailable: false }
  } catch (err) {
    if (isMethodMissing(err, MENU_READ_METHOD)) {
      return { headings: [], unavailable: MENU_READ_METHOD }
    }
    throw err
  }
}

export const createHeading = (venueId, heading) =>
  pick(
    () => call('shotright.api.add_product_heading', { venue_name: venueId, heading_name: heading }),
    () => mockBackend.createHeading(venueId, heading),
  )()

export const createItem = (headingId, payload) =>
  pick(
    () =>
      call('shotright.api.add_product_item', {
        heading_name: headingId,
        item_name: payload.item_name,
        price: payload.price,
        description: payload.description,
      }),
    () => mockBackend.createItem(headingId, payload),
  )()

/**
 * GAP: the collection has no `delete_product_item`.
 *
 * This used to call the mock unconditionally, which meant that against the real
 * bench the row vanished from the screen, the partner believed it was gone, and
 * it was still on their menu in the customer app after a refresh. A silent
 * no-op dressed as a success is worse than no delete at all.
 *
 * `frappe.client.delete` is the generic fallback and works if the Vendor role
 * has delete permission on the item doctype. If it doesn't, the partner gets a
 * real permission error and knows the item is still there — which is the truth.
 */
export const deleteItem = (itemId) =>
  pick(
    () => call('frappe.client.delete', { doctype: 'Product Item', name: itemId }),
    () => mockBackend.deleteItem(itemId),
  )()

export const importMenu = (venueId, rows) =>
  pick(
    () => call('shotright.api.bulk_import_products', { venue_name: venueId, rows }),
    () => mockBackend.importMenu(venueId, rows),
  )()

/**
 * Real .xlsx import: upload the file, then hand the resulting File docname to
 * the importer. Expected header row: heading_name, item_name, price,
 * description.
 */
export const importMenuFromExcel = async (venueId, file) => {
  if (USE_MOCKS) return mockBackend.importMenu(venueId, [])
  const form = new FormData()
  form.append('file', file)
  form.append('is_private', '1')
  const uploaded = await api
    .post('/api/method/upload_file', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r) => r.data.message)
  return call('shotright.api.import_products_from_excel', {
    venue_name: venueId,
    file_name: uploaded.name,
  })
}

/**
 * GAP (C4): `add_product_item` accepts no image, so an uploaded photo has
 * nowhere to be attached. The upload itself works — the File is created — but
 * nothing links it to the item, so it will not appear in the customer app.
 * Kept so the wizard keeps working; createVenue warns the partner.
 */
export const uploadMenuImage = (file) =>
  pick(
    () => {
      const form = new FormData()
      form.append('file', file)
      form.append('is_private', '0')
      return api
        .post('/api/method/upload_file', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.message)
    },
    () => mockBackend.uploadMenuImage(file),
  )()

/* ----------------------------------------------------------- venue photos */

/**
 * A venue's own photographs — the room, the bar, the plate on the table.
 *
 * These are not a nice-to-have. Sho't Right sells a *mood*, and a listing with
 * no picture is asking someone to pick a Friday night on the strength of a name
 * and a dress code. Until this existed the portal had nowhere to put one at
 * all: a partner could describe their venue in three paragraphs and still have
 * nothing for a customer to look at.
 *
 * ⚠️ THE ENDPOINTS WERE REPORTED READY ON 27 JUL and could not be verified from
 * the build environment, which has no route to the bench. Nothing here assumes
 * they landed: the probe decides, per tab, and the fallbacks below stay exactly
 * as they were. If the names or parameters differ from the spec in
 * `docs/BACKEND-ASKS.md` §14, this degrades to the pre-deployment behaviour
 * rather than to a lie — see `saveVenuePhotos` for the one case where that took
 * an extra round trip to guarantee.
 *
 * What we do when they are ABSENT is deliberate, and is NOT "pretend it worked":
 *
 *   1. The upload itself is real. Frappe's stock `upload_file` creates the File
 *      on the bench, and when the venue already exists we pass `doctype` and
 *      `docname` so the photo lands as an attachment ON that Venue. A moderator
 *      reviewing the venue in Desk can see it. That is genuine value today.
 *   2. Ordering and the cover photo need a field to live in, and there isn't
 *      one. `saveVenuePhotos` asks for the endpoint, and when it is absent says
 *      so — to the caller, which passes it to the partner.
 *
 * The distinction the partner is entitled to: their photos are UPLOADED and not
 * lost, but are not yet SHOWN to customers. Saying "saved!" over that would be
 * the menu-delete bug again — a silent no-op dressed as a success.
 */
export const PHOTOS_SAVE_METHOD = 'shotright.api.set_venue_photos'
export const PHOTOS_READ_METHOD = 'shotright.api.get_venue_photos'

/** Max photos per venue. A listing, not an album. */
export const MAX_VENUE_PHOTOS = 10

/**
 * Upload one photo.
 *
 * `venueId` is optional because the wizard has no venue yet — step 2 runs long
 * before `create_venue`. Uploading anyway (rather than holding the bytes until
 * submit) is what lets the partner SEE their photo while they are still
 * choosing, and what lets a resumed draft come back with its pictures: a draft
 * carries `file_url` strings, and could never carry a File object.
 */
/**
 * Does this failure mean "you may not attach to that doc", rather than
 * "the upload failed"?
 *
 * ⚠️ Reported 28 Jul, on a real partner's own venue:
 *
 *   User mlumanda@gmail.com does not have doctype access via role permission
 *   for document Venue
 *
 * The Vendor role has NO direct permission on the `Venue` doctype — everything
 * legitimately goes through whitelisted `shotright.api.*` methods that elevate
 * internally. That is a sound way to build a Frappe app, and it means stock
 * `upload_file` can never attach a photo to a Venue for a vendor. It also
 * explains the other two symptoms we've been chasing: `frappe.client.get_list`
 * on File is refused for the same reason, and so is `attachOrphans`.
 *
 * So attaching is not a thing this bench will do for us, and the whole upload
 * failing over it is the wrong outcome — the partner's photograph is fine.
 */
/**
 * Kept after the permission landed, and deliberately.
 *
 * It no longer decides whether to retry — it decides what a partner is told
 * when something that should now work doesn't. A regressed role permission
 * would otherwise surface as a sentence about doctypes, which is how this
 * started.
 */
const isAttachPermissionError = (err) => {
  const text = `${err?.message || ''} ${err?.detail || ''}`
  return (
    err?.status === 403 ||
    /PermissionError/i.test(err?.excType || '') ||
    /doctype access|not permitted|no permission|role permission/i.test(text)
  )
}

/**
 * Upload one photo.
 *
 * `venueId` is optional because the wizard has no venue yet — step 2 runs long
 * before `create_venue`. Uploading anyway (rather than holding the bytes until
 * submit) is what lets the partner SEE their photo while they are still
 * choosing, and what lets a resumed draft come back with its pictures: a draft
 * carries `file_url` strings, and could never carry a File object.
 *
 * ✅ 28 Jul: the Vendor role can attach to `Venue`. The unattached retry is
 * gone, and its removal is the point rather than a tidy-up.
 *
 * That fallback existed because a permission wall would otherwise have thrown
 * away a perfectly good photograph. What it produced instead was a photo that
 * uploaded, appeared in the uploader, and was attached to nothing — so the
 * partner saw success, the moderator opened the Venue and saw no pictures, and
 * nobody was in a position to notice the difference. A quiet wrong result,
 * which is the failure mode this project keeps being bitten by.
 *
 * With attaching genuinely available, a refusal is no longer a fact of life to
 * be worked around. It is an anomaly, and it should be loud.
 */
export const uploadVenuePhoto = (file, { venueId, onProgress } = {}) =>
  pick(
    async () => {
      const form = new FormData()
      form.append('file', file, file.name)
      form.append('is_private', '0') // customers have to be able to see it
      form.append('folder', 'Home/Attachments')
      if (venueId) {
        form.append('doctype', 'Venue')
        form.append('docname', venueId)
      }

      let uploaded
      try {
        const { data } = await api.post('/api/method/upload_file', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
        })
        uploaded = data.message || {}
      } catch (err) {
        /* Loud, but not cruel, and above all not "try again" — the one thing
           the partner definitely should not do is keep pressing a button that
           cannot work. This is ours to fix, and the message says so. */
        if (venueId && isAttachPermissionError(err)) {
          const refused = new Error(
            `We couldn’t attach ${file.name} to this venue — the app isn’t allowed to, ` +
              `which is our problem and not yours. Nothing you’ve done is lost. ` +
              `We’ve been told about it.`,
          )
          refused.retryable = false
          refused.cause = err
          throw refused
        }
        throw err
      }

      return {
        name: uploaded.name,
        file_url: uploaded.file_url,
        file_name: uploaded.file_name || file.name,
        attached: Boolean(venueId),
      }
    },
    () => mockBackend.uploadVenuePhoto(file, venueId),
  )()

const photoRow = (photo, index) => ({
  file_url: photo.file_url,
  file_name: photo.file_name,
  file: photo.name, // the File docname, so the backend can link rather than copy
  idx: index + 1,
  is_cover: index === 0,
})

/**
 * Persist the set and its ORDER.
 *
 * Order is the whole reason this is a call and not just a series of uploads:
 * photo one is the picture on the listing card, and a partner who drags their
 * best shot to the front has made a real editorial decision that must survive.
 *
 * Returns `{ saved }`. `saved: false` is not a failure to report as an error —
 * it means the endpoint is not deployed, and carries `method` so the caller can
 * name it. Anything genuinely wrong still throws.
 */
export const saveVenuePhotos = (venueId, photos) =>
  pick(
    () =>
      withFallback(
        PHOTOS_SAVE_METHOD,
        async () => {
          await call(PHOTOS_SAVE_METHOD, {
            venue_name: venueId,
            photos: photos.map(photoRow),
          })

          /**
           * A 200 is not proof, and this is the one place where believing it
           * would be worst.
           *
           * The endpoint EXISTING and the endpoint UNDERSTANDING US are
           * different things. If `photos` is spelt differently server-side,
           * Frappe drops the argument, saves nothing, and returns 200 — and the
           * probe has already told the uploader it is safe to promise these
           * reach customers. The partner is then told their gallery is live
           * over an empty child table, which is a worse outcome than the
           * missing endpoint we started with, because nobody is looking for it.
           *
           * So: read it back. One extra request on a rare action, in exchange
           * for never claiming a save that did not happen.
           */
          const check = await getVenuePhotos(venueId).catch(() => null)
          // Only the real read endpoint can answer this. `ordered: false` means
          // it fell back to listing File attachments, which legitimately shows
          // zero for a venue whose photos went up before it existed — treating
          // that as a mismatch would raise an alarm about a save that was fine.
          if (check?.ordered && check.photos.length < photos.length) {
            return {
              saved: false,
              method: PHOTOS_SAVE_METHOD,
              mismatch: { sent: photos.length, stored: check.photos.length },
            }
          }
          return { saved: true }
        },
        async () => ({
          saved: false,
          method: PHOTOS_SAVE_METHOD,
          // Best effort so the work is not stranded: attach whatever went up
          // before the venue existed, so a moderator at least has the pictures
          // in front of them. Failure here is silent by design — it is a
          // consolation prize, and reporting it as an error would bury the
          // thing that actually matters, which is the missing endpoint.
          attached: await attachOrphans(venueId, photos),
        }),
      ),
    async () => mockBackend.saveVenuePhotos(venueId, photos),
  )()

/** Link Files uploaded before the venue existed. Returns how many stuck. */
async function attachOrphans(venueId, photos) {
  let linked = 0
  for (const photo of photos) {
    if (!photo.name || photo.attached) continue
    try {
      await call('frappe.client.set_value', {
        doctype: 'File',
        name: photo.name,
        fieldname: { attached_to_doctype: 'Venue', attached_to_name: venueId },
      })
      linked += 1
    } catch {
      // No write permission on File for the Vendor role, most likely. The
      // photo is still uploaded; it is just not on the Venue doc.
    }
  }
  return linked
}

/**
 * Read a venue's photos back.
 *
 * Falls back to listing the Venue's File attachments, which is what the upload
 * path above actually produces today. Attachments have no order and no cover
 * flag, so they come back in upload order — honest, and the reason the
 * uploader tells the partner that ordering is not saved yet.
 */
export const getVenuePhotos = (venueId) =>
  pick(
    () =>
      withFallback(
        PHOTOS_READ_METHOD,
        async () => {
          const rows = (await callGet(PHOTOS_READ_METHOD, { venue_name: venueId })) || []
          return { photos: rows.map(normalisePhoto), ordered: true, readable: true }
        },
        async () => {
          try {
            const files = await callGet('frappe.client.get_list', {
              doctype: 'File',
              filters: JSON.stringify({
                attached_to_doctype: 'Venue',
                attached_to_name: venueId,
                is_folder: 0,
              }),
              fields: JSON.stringify(['name', 'file_url', 'file_name']),
              order_by: 'creation asc',
              limit_page_length: MAX_VENUE_PHOTOS,
            })
            return {
              photos: (files || [])
                .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f.file_url || ''))
                .map(normalisePhoto),
              ordered: false,
              readable: true,
            }
          } catch {
            /**
             * ⚠️ REPORTED 28 Jul: "the images uploaded seem to not persist".
             *
             * This catch used to return `{photos: [], ordered: false}` — the
             * SAME value as a venue that genuinely has no photographs. So when
             * the read failed (most likely `frappe.client.get_list` on File
             * being denied to the Vendor role, which is a reasonable thing for
             * a bench to deny) the uploader came back empty, and a partner who
             * had just added six photos concluded they had been thrown away.
             *
             * They had not. The upload is real, the File exists, and on a venue
             * that already exists it is attached to the Venue where a moderator
             * can see it. The only thing that failed was us reading it back.
             *
             * `readable: false` is the difference between "you have no photos"
             * and "we can't see your photos from here", and the partner is
             * entitled to know which one they are looking at. Same lesson as
             * the decline notes, twice in one day: an empty result and a failed
             * read must never render as the same screen.
             */
            return { photos: [], ordered: false, readable: false }
          }
        },
      ),
    async () => ({ photos: await mockBackend.getVenuePhotos(venueId), ordered: true }),
  )()

/**
 * Can this bench hold a venue's photos at all?
 *
 * Asked BEFORE the partner starts, not after they finish. The wizard has no
 * venue id, so there is nothing to read and nothing to save — and finding out
 * at submit that eight carefully-ordered photographs are not going anywhere is
 * the kind of thing that makes someone stop trusting the whole form.
 *
 * `withFallback` cannot answer this, and that is the point: it caches a 404 as
 * "method missing" whatever caused it, so probing with a venue name that does
 * not exist would poison the cache for a method that is perfectly fine.
 * `isMethodMissing` reads the exception text instead, so a missing DOCUMENT (or
 * a permission error, or anything else) counts as proof the endpoint is there.
 */
let photoSupport = null

export const venuePhotosSupported = () => {
  if (USE_MOCKS) return Promise.resolve(true)
  if (!photoSupport) {
    photoSupport = callGet(PHOTOS_READ_METHOD, { venue_name: '__shotright_capability_probe__' })
      .then(() => true)
      .catch((err) => !isMethodMissing(err, PHOTOS_READ_METHOD))
  }
  return photoSupport
}

const normalisePhoto = (row) => ({
  name: row.file || row.name,
  file_url: row.file_url,
  file_name: row.file_name || row.file_url?.split('/').pop() || 'photo',
  attached: true,
})

/* ------------------------------------------------------------------ profile */

/**
 * Normalised so every caller sees a `vendor_name` whatever the bench actually
 * calls the field — see `services/profile.js` for why that is not a given.
 */
export const getProfile = () =>
  pick(
    async () => {
      const dash = await call('shotright.api.get_vendor_dashboard')
      return normaliseProfile(dash?.profile)
    },
    async () => normaliseProfile(await mockBackend.getProfile()),
  )()

/**
 * Returns the profile as the bench holds it AFTER the write, not the write's
 * own response.
 *
 * `update_vendor_profile` returning 200 does not mean it saved what you sent:
 * Frappe silently drops kwargs a method does not declare, so a field named
 * wrongly produces a successful no-op. Re-reading is the only way to know, and
 * the caller compares to decide what to tell the partner. One extra request on
 * a rare action is a fair price for not lying about it.
 */
export const updateProfile = (payload) =>
  pick(
    async () => {
      await call('shotright.api.update_vendor_profile', toProfilePayload(payload))
      return getProfile()
    },
    async () => normaliseProfile(await mockBackend.updateProfile(toProfilePayload(payload))),
  )()

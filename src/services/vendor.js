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
 *
 * Methods live in a flat `shotright.api.*` namespace — not `.vendor.*`.
 */
import api, { call, callGet, USE_MOCKS, setAuthToken, hasAuthToken } from './api'
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
export const __resetCapabilities = () => capabilities.clear()

/* --------------------------------------------------------------------- auth */

/** Exchanges credentials for a reusable api_key/api_secret pair. */
export const login = (email, password) =>
  pick(
    async () => {
      const result = await call('shotright.api.login', { email, password })
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

export const getVenue = (venueId) =>
  pick(
    () => callGet('shotright.api.get_venue_detail', { venue_name: venueId }),
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

      return { venue, warnings }
    },
    async () => ({ venue: await mockBackend.createVenue(payload), warnings: [] }),
  )()

export const updateVenue = (venueId, payload) =>
  pick(
    () => call('shotright.api.update_venue', { venue_name: venueId, ...payload }),
    () => mockBackend.updateVenue(venueId, payload),
  )()

/* --------------------------------------------------------------------- menu */

export const getMenu = (venueId) =>
  pick(
    () => callGet('shotright.api.get_venue_products', { venue_name: venueId }),
    () => mockBackend.getMenu(venueId),
  )()

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

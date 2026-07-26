/**
 * Vendor-facing API for the `shotright` Frappe app.
 *
 * Every call site the portal has is in this file, and each picks between the
 * real endpoint and an in-memory mock of the same shape (`VITE_USE_MOCKS`).
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
import api, { call, callGet, USE_MOCKS, setAuthToken } from './api'
import { mockBackend } from './mockBackend'

const pick = (real, mock) => (USE_MOCKS ? mock : real)

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
 */
export const getSession = () =>
  pick(
    async () => {
      const dash = await call('shotright.api.get_vendor_dashboard')
      return { user: dash?.profile?.email, vendor_profile: dash?.profile }
    },
    () => mockBackend.getLoggedUser(),
  )()

/* -------------------------------------------------------------------- moods */

/**
 * GAP: the collection exposes no endpoint that lists the curated Mood list,
 * even though create_venue requires moods to come from it. Until one exists the
 * typeahead has nothing authoritative to read, so this stays on fixtures even
 * when mocks are otherwise off. Tracked in docs/BACKEND-INTEGRATION.md.
 */
export const getMoods = () => mockBackend.getMoods()

/**
 * GAP: no `resolve_mood` endpoint, and no Mood Suggestion doctype. Resolution
 * therefore runs locally against whatever getMoods() returned. A mood the
 * partner invents resolves to `status: 'suggested'` and is REPORTED to them,
 * but cannot be saved — createVenue drops it and tells the caller which ones
 * went. Do not "fix" that by silently sending it: create_venue rejects unknown
 * moods, which would fail the whole submit.
 */
export const resolveMood = (text) => mockBackend.resolveMood(text)

/**
 * GAP: no lookup endpoint for dress codes or atmospheres. Note the backend's
 * `atmosphere_desc` is free text, not a select, so the portal's dropdown is a
 * convenience over a text field rather than a constrained list.
 */
export const getVenueLookups = () => mockBackend.getVenueLookups()

/* ---------------------------------------------------------------- dashboard */

export const getDashboard = () =>
  pick(
    () => call('shotright.api.get_vendor_dashboard'),
    () => mockBackend.getDashboard(),
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

      // C1: only moods already on the curated list may be sent.
      const canonical = (payload.moods || []).filter((m) => m.status === 'canonical')
      const suggested = (payload.moods || []).filter((m) => m.status !== 'canonical')
      if (suggested.length) {
        warnings.push(
          `${suggested.length} new mood${suggested.length === 1 ? '' : 's'} ` +
            `(${suggested.map((m) => m.label).join(', ')}) could not be saved — ` +
            `the app only accepts moods already on the Sho't Right list.`,
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

      const venue = await call('shotright.api.create_venue', {
        venue_name: payload.venue_name,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        dress_code: payload.dress_code,
        atmosphere_desc: payload.atmosphere,
        moods: canonical.map((m) => m.label),
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

/** GAP: no delete endpoint in the collection. Mock-only until one exists. */
export const deleteItem = (itemId) => mockBackend.deleteItem(itemId)

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

export const getProfile = () =>
  pick(
    async () => {
      const dash = await call('shotright.api.get_vendor_dashboard')
      return dash?.profile
    },
    () => mockBackend.getProfile(),
  )()

export const updateProfile = (payload) =>
  pick(
    () => call('shotright.api.update_vendor_profile', payload),
    () => mockBackend.updateProfile(payload),
  )()

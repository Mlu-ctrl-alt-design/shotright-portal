/**
 * The portal's entire backend contract lives here.
 *
 * Every function has two implementations: the real Frappe call, and a mock.
 * `USE_MOCKS` picks between them, so the views/hooks never know which is live.
 * When the `shotright` Frappe app ships (#2/#14/#15/#17), set
 * VITE_USE_MOCKS=false — nothing above this file changes.
 *
 * Method paths follow the app's api module layout:
 *   shotright.api.auth.*     guest endpoints (login, register)
 *   shotright.api.vendor.*   authenticated vendor endpoints
 */
import api, { call, callGet, USE_MOCKS, setCsrfToken } from './api'
import { mockBackend } from './mockBackend'

const pick = (real, mock) => (USE_MOCKS ? mock : real)

/* ---------------------------------------------------------------- auth (#14) */

export const login = (usr, pwd) =>
  pick(
    async () => {
      // Frappe's built-in login establishes the session cookie. The custom
      // endpoint then resolves the Vendor Profile and hands back a fresh CSRF
      // token for subsequent writes.
      await api.post('/api/method/login', { usr, pwd })
      const session = await call('shotright.api.auth.get_vendor_session')
      setCsrfToken(session?.csrf_token)
      return session
    },
    () => mockBackend.login({ usr, pwd }),
  )()

export const register = (payload) =>
  pick(
    async () => {
      const session = await call('shotright.api.auth.register_vendor', payload)
      setCsrfToken(session?.csrf_token)
      return session
    },
    () => mockBackend.register(payload),
  )()

export const logout = () =>
  pick(
    async () => {
      await api.post('/api/method/logout')
      setCsrfToken(null)
      return { ok: true }
    },
    () => mockBackend.logout(),
  )()

/** Used on boot to turn a surviving session cookie back into app state. */
export const getSession = () =>
  pick(
    async () => {
      const session = await callGet('shotright.api.auth.get_vendor_session')
      setCsrfToken(session?.csrf_token)
      return session
    },
    () => mockBackend.getLoggedUser(),
  )()

/* --------------------------------------------------------------- moods (#20) */

export const getMoods = () =>
  pick(
    () => callGet('shotright.api.vendor.get_moods'),
    () => mockBackend.getMoods(),
  )()

/**
 * Resolve a partner-typed mood against the Mood master (conflict C1, resolved
 * in favour of free text that creates suggestions).
 *
 * Returns `{ status: 'canonical' | 'suggested', mood, label, near }`. The
 * portal never decides this itself — matching and suggestion-creation belong on
 * the bench so the Excel importer and any future surface behave identically.
 */
export const resolveMood = (text) =>
  pick(
    () => call('shotright.api.vendor.resolve_mood', { text }),
    () => mockBackend.resolveMood(text),
  )()

/**
 * Upload a menu item photo (conflict C4, resolved: images live on the bench).
 *
 * Posts to Frappe's stock `upload_file`, which creates a File record and returns
 * its `file_url`. The upload happens before the venue exists, so the File is
 * created unattached and linked to the Product Item on submit — Frappe allows
 * this, and it means a partner sees their photo immediately rather than only
 * after the whole wizard is saved.
 *
 * `is_private: 0` because these are shown to customers in the app.
 */
export const uploadMenuImage = (file) =>
  pick(
    () => {
      const form = new FormData()
      form.append('file', file)
      form.append('is_private', '0')
      form.append('folder', 'Home/Attachments')
      return api
        .post('/api/method/upload_file', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data.message)
    },
    () => mockBackend.uploadMenuImage(file),
  )()

/** Dropdown data for the venue details step — dress codes and atmospheres. */
export const getVenueLookups = () =>
  pick(
    () => callGet('shotright.api.vendor.get_venue_lookups'),
    () => mockBackend.getVenueLookups(),
  )()

/* ----------------------------------------------------------- dashboard (#18) */

export const getDashboard = () =>
  pick(
    () => callGet('shotright.api.vendor.get_dashboard'),
    () => mockBackend.getDashboard(),
  )()

/* --------------------------------------------------------------- venues (#15) */

export const getVenues = () =>
  pick(
    () => callGet('shotright.api.vendor.get_my_venues'),
    () => mockBackend.getVenues(),
  )()

export const getVenue = (venueId) =>
  pick(
    () => callGet('shotright.api.vendor.get_venue_detail', { venue_id: venueId }),
    () => mockBackend.getVenue(venueId),
  )()

export const createVenue = (payload) =>
  pick(
    () => call('shotright.api.vendor.create_venue', payload),
    () => mockBackend.createVenue(payload),
  )()

export const updateVenue = (venueId, payload) =>
  pick(
    () => call('shotright.api.vendor.update_venue', { venue_id: venueId, ...payload }),
    () => mockBackend.updateVenue(venueId, payload),
  )()

/* ------------------------------------------------------- products / menu (#17) */

export const getMenu = (venueId) =>
  pick(
    () => callGet('shotright.api.vendor.get_venue_menu', { venue_id: venueId }),
    () => mockBackend.getMenu(venueId),
  )()

export const createHeading = (venueId, heading) =>
  pick(
    () => call('shotright.api.vendor.create_product_heading', { venue_id: venueId, heading }),
    () => mockBackend.createHeading(venueId, heading),
  )()

export const createItem = (headingId, payload) =>
  pick(
    () => call('shotright.api.vendor.create_product_item', { heading_id: headingId, ...payload }),
    () => mockBackend.createItem(headingId, payload),
  )()

export const deleteItem = (itemId) =>
  pick(
    () => call('shotright.api.vendor.delete_product_item', { item_id: itemId }),
    () => mockBackend.deleteItem(itemId),
  )()

/** Bulk menu import. Rows are parsed client-side; the server revalidates. */
export const importMenu = (venueId, rows) =>
  pick(
    () => call('shotright.api.vendor.import_menu', { venue_id: venueId, rows: JSON.stringify(rows) }),
    () => mockBackend.importMenu(venueId, rows),
  )()

/* -------------------------------------------------------------- profile (#19) */

export const getProfile = () =>
  pick(
    () => callGet('shotright.api.vendor.get_my_profile'),
    () => mockBackend.getProfile(),
  )()

export const updateProfile = (payload) =>
  pick(
    () => call('shotright.api.vendor.update_my_profile', payload),
    () => mockBackend.updateProfile(payload),
  )()

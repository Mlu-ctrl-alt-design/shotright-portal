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
import { plainText } from '../utils/html'
import { minutesSinceMidnight } from '../utils/time'

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
      /**
       * The method name goes to the CONSOLE, not to the partner.
       *
       * It used to be printed on screen — "the portal is asking for
       * shotright.api.update_venue, and it isn't there" — on the reasoning that
       * naming it got it fixed faster. It did, and it was still wrong: a
       * restaurant owner reading a dotted Python path has been handed our
       * problem to hold.
       *
       * Logged once per method per tab (the capability cache guarantees that),
       * so a screenshot of the console still answers "which endpoint?" without
       * a single partner-facing screen mentioning one.
       */
      console.warn(
        `[shotright] endpoint not available on this server: ${method}`,
        '— the portal has fallen back. This is a deployment gap, not a user error.',
      )
      return whenMissing()
    }
    throw err
  }
}

/** Test seam — lets a test reset what the portal thinks the bench supports. */
export const __resetCapabilities = () => {
  capabilities.clear()
  photoSupport = null
  googleSupport = null
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
 * Signing in with Google.
 *
 * WE DO NOT KNOW WHAT THE BENCH CALLS THIS. The mobile app has Google sign-in,
 * so something exists; the portal has never been told its name. Rather than
 * guess one and ship a button that 404s, the same shape used everywhere else
 * here applies — a list of candidates, tried in order, and the feature simply
 * does not appear when none of them is deployed.
 *
 * THE PARAMETER NAME IS ALSO A GUESS, and unlike a form field a wrong kwarg on
 * a whitelisted method is fatal: Frappe raises TypeError rather than ignoring
 * it. So each method is tried with each name, and an unexpected-keyword error
 * moves on to the next rather than surfacing.
 */
export const GOOGLE_AUTH_METHODS = [
  'shotright.api.login_with_google',
  'shotright.api.google_login',
  'shotright.api.login_google',
  'shotright.api.social_login',
]

const GOOGLE_CREDENTIAL_PARAMS = ['credential', 'id_token', 'token']

const isWrongParameter = (err) =>
  /unexpected keyword argument|got an unexpected|missing \d+ required positional/i.test(
    `${err?.message || ''} ${err?.detail || ''} ${err?.excType || ''}`,
  )

/**
 * Is there anything on the other end?
 *
 * Probed by calling each candidate with NO credential. A method that is not
 * there answers 404 `DoesNotExistError`; a method that is there rejects the
 * empty call with a validation error, and that rejection is the proof we want.
 * `isMethodMissing` reads the exception text, which is the only thing that
 * separates a missing METHOD from a missing DOCUMENT on this bench.
 *
 * No credential is sent, so a probe cannot log anybody in or out.
 *
 * Cached for the tab: the login screen must not fire four requests per render.
 */
let googleSupport = null

export const googleAuthSupported = () => {
  if (USE_MOCKS) return Promise.resolve(true)
  if (!googleSupport) {
    googleSupport = (async () => {
      for (const method of GOOGLE_AUTH_METHODS) {
        try {
          await call(method, {})
          return true
        } catch (err) {
          if (!isMethodMissing(err, method)) return true
        }
      }
      return false
    })()
  }
  return googleSupport
}

/**
 * Exchange a Google ID token for the portal's own api_key/api_secret.
 *
 * The token is Google's claim about who this is; only the bench can check it
 * against Google's signing keys, so nothing here inspects or trusts it. What
 * comes back is the same shape as `login`, including the `otp_required` branch
 * — a Google account can still belong to a partner who has not finished
 * verifying, and walking them past that is how someone ends up on a dashboard
 * with nothing to authenticate with.
 */
export const loginWithGoogle = async (credential) => {
  if (!credential) throw new Error('Google didn’t give us anything to sign in with.')

  if (USE_MOCKS) {
    setAuthToken({ api_key: 'mock', api_secret: 'mock' })
    return { api_key: 'mock', api_secret: 'mock' }
  }

  let lastError = null
  for (const method of GOOGLE_AUTH_METHODS) {
    for (const param of GOOGLE_CREDENTIAL_PARAMS) {
      try {
        const result = await call(method, { [param]: credential })
        if (result?.otp_required) {
          return { otpRequired: true, email: result.email }
        }
        setAuthToken(result)
        return result
      } catch (err) {
        if (isMethodMissing(err, method)) break // wrong method, not wrong name
        if (isWrongParameter(err)) continue // right method, try the next name
        throw err // a real refusal: a rejected token, a blocked account
      }
    }
  }

  /* Every candidate was absent. The button should not have been on screen —
     `googleAuthSupported` gates it — so this is a deployment that changed under
     a tab that was already open. */
  throw lastError ||
    new Error('Signing in with Google isn’t available on this server yet. Use your password.')
}

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

/**
 * Pull mood keys out of whatever shape a venue's `moods` arrived in.
 *
 * ⚠️ Reported 8 Aug: *"when a user edits a venue they are unable to save
 * because the moods are throwing an error."* This is that bug, and it was never
 * a server error — it was ours.
 *
 * `moods` is a CHILD TABLE on `Venue` (§00). Depending on which endpoint
 * answers, it comes back as plain ids, as child rows (`{mood: 'MOOD-CHILLED'}`),
 * or as labels. The edit form seeded itself straight from it and matched with
 * `.includes(mood.name)` — so the moment the shape was anything but a list of
 * docnames, **nothing matched, zero moods showed as selected, and the form's
 * own "select at least one mood" rule refused to submit.** A partner could not
 * save a venue they had changed nothing about.
 *
 * The `get_venue_detail` 404 (§0) makes it far more likely, not less: when
 * detail 404s we fall back to the dashboard row, and the two endpoints have no
 * obligation to describe a child table the same way.
 *
 * BEING GENEROUS HERE IS SAFE, and it is worth saying why, because §00 says the
 * opposite about writing. Reading a shape wrong shows a partner the wrong
 * checkboxes, which they can see and correct. WRITING a guessed child-row shape
 * makes Frappe create empty rows and report success, silently erasing a venue's
 * moods with nothing on screen to show for it. So: read every shape, write only
 * what we were given.
 */
export const moodKeysOf = (moods) => {
  if (!Array.isArray(moods)) return []
  return moods
    .map((m) => {
      if (typeof m === 'string') return m.trim()
      if (!m || typeof m !== 'object') return ''
      return String(m.mood || m.name || m.mood_name || m.label || m.value || '').trim()
    })
    .filter(Boolean)
}

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
        /**
         * The only thing from a Google listing that reaches the database.
         *
         * Storable indefinitely, unlike every other Places field, and it is
         * what lets the bench notice that two partners have claimed the same
         * restaurant — a duplicate splits one venue's bookings across two
         * listings, and neither owner sees the halves.
         *
         * Sent as `undefined` when absent so it does not overwrite anything,
         * and if `create_venue` does not declare it Frappe drops it at 200 with
         * no complaint. That is survivable — the venue saves and the dedupe is
         * simply not available — but it is invisible, so it is filed as §20
         * rather than left to be discovered.
         */
        place_id: payload.place_id || undefined,
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
                  `nothing has been lost — we’re getting the rest attached.`
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
      `accept ${labels.length === 1 ? 'that change' : 'those changes'} yet.`,
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
/**
 * Fields where ORDER IS NOT A CHANGE.
 *
 * Moods are a set — "Chilled and Lively" is the same venue as "Lively and
 * Chilled". Comparing them as ordered JSON meant that un-ticking a mood and
 * re-ticking it counted as an edit, which sent `moods` to `update_venue`, which
 * is the one field it cannot accept (§00). A partner who touched the mood
 * checkboxes and changed their mind back was handed a crash for it.
 *
 * `operating_hours` is deliberately NOT here: those rows are per-day and their
 * order carries meaning we should not be second-guessing.
 */
const UNORDERED_FIELDS = new Set(['moods'])

/**
 * Two sets of opening hours, compared as TIMES rather than as strings.
 *
 * The form holds "09:00" and the bench sends back "9:00:00" for the same
 * moment, so a plain JSON comparison says every venue's hours changed on every
 * save — which matters now that a read-back reports anything that did not
 * change as "didn't stick". See `utils/time.js` for why the hour is unpadded.
 */
const sameHours = (a, b) => {
  const rows = (list) =>
    (Array.isArray(list) ? list : []).map((r) =>
      [
        r?.day_of_week,
        Boolean(r?.closed),
        minutesSinceMidnight(r?.open_time),
        minutesSinceMidnight(r?.close_time),
      ].join('|'),
    )
  const left = rows(a)
  const right = rows(b)
  return left.length === right.length && left.every((v, i) => v === right[i])
}

const sameSet = (a, b) => {
  const left = [...moodKeysOf(a)].sort()
  const right = [...moodKeysOf(b)].sort()
  return left.length === right.length && left.every((v, i) => v === right[i])
}

const same = (a, b, field) => {
  if (a === b) return true
  if (a == null && b == null) return true
  if (a === '' && b == null) return true
  if (b === '' && a == null) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    /* Compared as sets AND across shapes, so a list of ids and the same list as
       child rows do not read as a change. Both halves matter: without the
       shape-blindness, every save of a venue whose moods came back as objects
       would send `moods` and hit §00. */
    if (UNORDERED_FIELDS.has(field)) return sameSet(a, b)
    if (field === 'operating_hours') return sameHours(a, b)
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
    if (current && same(payload[field], current[field], field)) continue
    body[field] = payload[field]
  }
  if (renaming) {
    body.new_name = wanted
    body.new_venue_name = wanted
  }
  // Last, so nothing above can reach it.
  body.venue_name = venueId

  const refused = await writeVenue(body)

  /**
   * WHAT ACTUALLY LANDED.
   *
   * Reported from the live site: "some fields on the venue screen do not
   * persist — e.g. the starting time, the moods." Neither was being reported as
   * a failure, because neither WAS one as far as this code could tell: Frappe
   * discards a kwarg its whitelisted method does not declare, silently, at HTTP
   * 200. The save succeeds, the field is dropped, and the partner is told it
   * worked. They find out when a customer turns up at nine for a ten o'clock
   * opening.
   *
   * A 200 proves routing, not persistence — the same lesson as the venue
   * photos and the rename. So: read the venue back and compare what we sent
   * against what is now there. Anything that did not change is named, in the
   * partner's words, next to the fields that were refused outright.
   *
   * `sent` excludes the identifier and the rename aliases: `venue_name` is how
   * we said WHICH venue, and a bounced rename is reported by the named check
   * below in a sentence that means more than "the name didn't stick".
   */
  const verifyDropped = (stored) => {
    if (!stored) return []
    const sent = Object.keys(body).filter(
      (f) => f !== 'venue_name' && f !== 'new_name' && f !== 'new_venue_name',
    )
    return sent.filter((f) => {
      if (refused.includes(f)) return false
      /**
       * ABSENT IS NOT DROPPED.
       *
       * A field the read-back does not return at all tells us nothing: the
       * detail serialiser may simply not include it (they differ between
       * endpoints on this bench — see `moodKeysOf`). Only a field that comes
       * back with its OLD value is evidence that the write was discarded, and a
       * warning we cannot justify is worse than none, because a warning that
       * fires on ordinary saves is one people learn to click past.
       */
      if (stored[f] === undefined) return false
      return !same(body[f], stored[f], f)
    })
  }

  if (!renaming) {
    const stored = await getVenue(venueId)
    return {
      venue: stored,
      renamed: null,
      warnings: warnAboutRefused([...refused, ...verifyDropped(stored)]),
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
  const refusedWarnings = warnAboutRefused([...refused, ...verifyDropped(venue)])
  const renameWarning = renamed
    ? null
    : `The venue is still called “${venue?.venue_name || venueId}”. ` +
      // Said here only when nothing else is being reported, so a partner with
      // two problems doesn't read "everything else was saved" twice and have to
      // work out which "everything else" each one meant.
      (refusedWarnings.length ? '' : 'Everything else you changed was saved — but ') +
      `we can’t rename a venue just yet, so that part didn’t take.`

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

/**
 * One heading and its items, with the descriptions turned back into prose.
 *
 * ⚠️ Frappe stores a description as HTML, so the live site was showing partners
 * `<p>Tomatoes, creamy burrata…</p>` — their own sentence wrapped in markup the
 * bench added. Stripped on the way IN rather than at each render, so there is
 * one place it happens and no view can forget. `utils/html.js` says why this is
 * not `dangerouslySetInnerHTML`.
 */
const normaliseHeading = (heading) => ({
  ...heading,
  items: (heading?.items || []).map((item) => ({
    ...item,
    description: plainText(item?.description),
  })),
})

export const getMenu = async (venueId) => {
  if (USE_MOCKS) {
    const headings = await mockBackend.getMenu(venueId)
    return { headings: headings.map(normaliseHeading), unavailable: false }
  }
  try {
    const headings = await callGet(MENU_READ_METHOD, { venue_name: venueId })
    return { headings: (headings || []).map(normaliseHeading), unavailable: false }
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
 * Changing a menu item, and removing one.
 *
 * ⚠️ THE MENU IS HALF-BUILT, and this is the half that was missing. A partner
 * can add a heading and add items. Until now they could not CHANGE one at all
 * — a dish priced at R450 instead of R45 had to be deleted and retyped — and
 * the delete they'd have to use for that is itself unreliable.
 *
 * `frappe.client.delete` needs delete permission on `Product Item`, and we know
 * from the venue photo work that **the Vendor role has no doctype access at
 * all**; everything legitimate goes through whitelisted `shotright.api.*`
 * methods that elevate. So the generic call is very likely refused on the real
 * bench, which means "Remove" has probably never worked for anybody.
 *
 * Both go through a LIST of candidate method names, tried in order. Six name
 * mismatches on this project say guessing one is not a strategy; a list costs
 * a 404 the first time and nothing after that, and whichever the backend picks,
 * the portal finds it.
 */
export const ITEM_UPDATE_METHODS = [
  'shotright.api.update_product_item',
  'shotright.api.edit_product_item',
  'shotright.api.set_product_item',
]

export const ITEM_DELETE_METHODS = ['shotright.api.delete_product_item']

/**
 * How a menu item is named to the bench.
 *
 * ⚠️ FROM THE LIVE SITE, on every attempt to edit a menu item:
 *
 *   TypeError: update_product_item() missing 1 required positional argument:
 *   'item_id'
 *
 * The portal was sending `item` AND `name` — two guesses, neither of them the
 * one the method declares, and both of them extra kwargs on top of the missing
 * required one. `item_id` now goes first because the bench has told us that is
 * the name; the others stay behind it, tried only when a method rejects the
 * one before, so a differently-written endpoint still works.
 *
 * ONE AT A TIME, deliberately. Sending all three together looks like belt and
 * braces and is the opposite: Frappe's whitelisted call passes the form dict
 * straight into the function, so every name the method does not declare is an
 * unexpected keyword and a TypeError. Hedging works for multipart fields, which
 * is where this codebase learned the habit; it is actively harmful here.
 */
const ITEM_ID_PARAMS = ['item_id', 'item', 'name']

const isWrongItemParameter = (err) =>
  /unexpected keyword argument|missing \d+ required (positional|keyword)/i.test(
    `${err?.message || ''} ${err?.detail || ''} ${err?.excType || ''}`,
  )

/**
 * Call the first deployed method that accepts one of the identifier names.
 *
 * Returns `{result, method, param}`, or null when no candidate is deployed. A
 * real refusal — a permission error, a rejected value — is thrown rather than
 * being mistaken for a wrong guess.
 */
const callForItem = async (methods, itemId, extra = {}) => {
  for (const method of methods) {
    for (const param of ITEM_ID_PARAMS) {
      try {
        const result = (await call(method, { [param]: itemId, ...extra })) ?? { ok: true }
        return { result, method, param }
      } catch (err) {
        if (isMethodMissing(err, method)) break // this method is absent entirely
        if (isWrongItemParameter(err)) continue // right method, wrong name for it
        throw err
      }
    }
  }
  return null
}

/** Try each name; `undefined` from all of them means none is deployed. */
const firstDeployed = async (methods, args) => {
  for (const method of methods) {
    const result = await withFallback(
      method,
      async () => (await call(method, args)) ?? { ok: true },
      async () => undefined,
    )
    if (result !== undefined) return { result, method }
  }
  return null
}

/**
 * Edit an item.
 *
 * Returns `{saved: false, reason: 'no-endpoint'}` rather than throwing when the
 * bench has no way to do it — the caller turns that into words a partner can
 * act on, and keeps their typed values on screen so the work isn't lost.
 */
export const updateItem = async (itemId, payload) => {
  if (USE_MOCKS) return { saved: true, item: await mockBackend.updateItem?.(itemId, payload) }

  const body = { item_name: payload.item_name }
  if (payload.price !== undefined) body.price = payload.price
  if (payload.description !== undefined) body.description = payload.description

  const attempt = await callForItem(ITEM_UPDATE_METHODS, itemId, body)
  if (attempt) return { saved: true, method: attempt.method }

  return { saved: false, reason: 'no-endpoint' }
}

/**
 * Remove an item.
 *
 * A whitelisted method first, then the generic delete — which is kept because
 * a bench that DOES grant the permission should still work, and dropped to
 * quietly if it doesn't. `saved: false` is reported, never swallowed: a row
 * that vanishes from the screen and stays on the customer's menu is the exact
 * failure this function was rewritten to stop.
 */
export const deleteItem = async (itemId) => {
  if (USE_MOCKS) return mockBackend.deleteItem(itemId)

  const attempt = await callForItem(ITEM_DELETE_METHODS, itemId)
  if (attempt) return { deleted: true, method: attempt.method }

  try {
    await call('frappe.client.delete', { doctype: 'Product Item', name: itemId })
    return { deleted: true, method: 'frappe.client.delete' }
  } catch (err) {
    // A permission refusal is the expected answer on this bench, and it is not
    // the partner's fault or their problem to solve. Anything else is a real
    // error and still surfaces.
    if (err?.status === 403 || /PermissionError|not permitted|doctype access/i.test(
      `${err?.excType || ''} ${err?.message || ''} ${err?.detail || ''}`,
    )) {
      return { deleted: false, reason: 'not-allowed' }
    }
    /**
     * ⚠️ A bench that does not WHITELIST `frappe.client.delete` answers 404
     * `DoesNotExistError`, not 403 — and this used to rethrow that, so the menu
     * row printed the words "DoesNotExistError" at a restaurant owner.
     *
     * Cannot-delete is cannot-delete. Whether the method is absent or forbidden
     * changes nothing the partner can act on, so both come back the same way
     * and neither reaches a screen.
     */
    if (isMethodMissing(err, 'frappe.client.delete')) {
      return { deleted: false, reason: 'not-available' }
    }
    throw err
  }
}

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
 * ✅ 22 Aug — VERIFIED ON THE BENCH, and it changed the design.
 *
 * `upload_file` with `doctype=Venue` is **permanently 403** and always will be.
 * Vendors hold ["All", "Guest"]; `Venue` grants write to System Manager and
 * Venue Reviewer only. There is no attach grant, and — this is the part worth
 * keeping — **there must never be one**: Frappe role permissions are not
 * row-scoped, so granting Vendor write on `Venue` would let every partner write
 * every other partner's venue. My own standing ask had that backwards; it is
 * retracted in §19.b.
 *
 * Two things I asserted are refuted by measurement: the Vendor role CAN create
 * a `File` (role All), and `upload_file` with no doctype returns 200 — the menu
 * importer was never blocked by permissions at all.
 *
 * So there are two upload paths, and which one applies is decided by whether a
 * venue exists yet rather than by any capability probe:
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
/**
 * The whitelisted method that elevates internally — the fix, live since 22 Aug.
 *
 * This is what three separate symptoms were all asking for. It ends the
 * dependency on stock Frappe endpoints and the role permissions they need,
 * which is the dependency that produced "images don't persist", the 403 logout,
 * and the photo read falling back to nothing.
 */
export const PHOTO_UPLOAD_METHOD = 'shotright.api.upload_venue_photo'

export const uploadVenuePhoto = (file, { venueId, onProgress } = {}) =>
  pick(
    async () => {
      const form = new FormData()
      form.append('file', file, file.name)
      form.append('is_private', '0') // customers have to be able to see it

      /**
       * TWO PATHS, chosen by whether the venue exists yet.
       *
       * WITH a venue → `upload_venue_photo`, which elevates and attaches.
       * WITHOUT one → plain `upload_file` and NO doctype, which is verified to
       * return 200. The wizard uploads photos on step 2, long before
       * `create_venue` runs, so there is no venue to attach to and nothing to
       * elevate for; `create_venue` links the `file_url`s at the end.
       *
       * ⚠️ `doctype=Venue` IS NEVER SENT. It is a permanent 403 by design, not
       * a gap waiting to be filled — see the note above. Adding it back would
       * fail for every partner, for ever.
       *
       * The venue id goes under three names because Frappe drops kwargs a
       * method does not declare, silently, at 200 — and a photo that uploads
       * but attaches to nothing is the exact quiet-wrong-result this endpoint
       * exists to end. Costs nothing; removes a whole class of no-op.
       */
      const attaching = Boolean(venueId)
      if (attaching) {
        form.append('venue_name', venueId)
        form.append('venue', venueId)
        form.append('docname', venueId)
      } else {
        form.append('folder', 'Home/Attachments')
      }

      const endpoint = attaching
        ? `/api/method/${PHOTO_UPLOAD_METHOD}`
        : '/api/method/upload_file'

      let uploaded
      try {
        const { data } = await api.post(endpoint, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => onProgress?.(e.total ? e.loaded / e.total : 0),
        })
        uploaded = data.message || {}
      } catch (err) {
        /**
         * 417 — the server read the file and refused it.
         *
         * Verified 22 Aug: `.heic`, `.heif` and `.avif` come back 417 and
         * terminal. As of the format split in `utils/image.js` the portal
         * should no longer be ABLE to send one: `prepareImage` re-encodes
         * everything outside `UPLOADABLE_TYPES` to JPEG before it gets here,
         * and refuses with its own advice when it cannot decode the file at all.
         *
         * So this branch is now a backstop rather than a routine path, and if
         * it fires the conversion layer missed something. It stays because the
         * cost of being wrong about that is a partner who cannot list at all.
         *
         * Not retryable with THIS file — pressing again re-sends the same
         * bytes — but fixable by the partner, so the message says how rather
         * than apologising.
         */
        if (err?.status === 417) {
          const rejected = new Error(
            `The server wouldn’t accept ${file.name}. If it came off an iPhone, ` +
              `adding it from the phone itself usually works — open this page there ` +
              `and pick the photo. Otherwise a JPEG or PNG copy will go through.`,
          )
          rejected.retryable = false
          /**
           * ⚠️ DELIBERATELY NOT `blocksUpload`.
           *
           * `retryable` and `blocksUpload` were briefly the same flag, and that
           * was a bug: a rejected HEIC would have switched the "a photo is
           * required" rule off for the whole session. They mean different
           * things and only one of them is about the partner.
           *
           *   retryable:false  → pressing again sends the same bytes and fails
           *                      the same way, so do not offer "try again".
           *   blocksUpload     → uploading is not available AT ALL, so stop
           *                      demanding a photo nobody can provide.
           *
           * A wrong format is the first and not the second. The partner can fix
           * it in thirty seconds, and the message says how — so the requirement
           * stays, correctly.
           */
          rejected.cause = err
          throw rejected
        }
        /* Loud, but not cruel, and above all not "try again" — the one thing
           the partner definitely should not do is keep pressing a button that
           cannot work. This is ours to fix, and the message says so. */
        /**
         * ⚠️ THE `venueId &&` GUARD WAS A BUG. Removed 13 Aug.
         *
         * It meant a refusal only counted as unretryable when there was a venue
         * to attach to — i.e. on the EDIT form. In the wizard, which is where
         * most photos are uploaded and where no venue exists yet, the same 403
         * fell through to the generic branch and told the partner to **try
         * again**. The tenth attempt is refused exactly like the first, so that
         * is an afternoon of somebody's time.
         *
         * It is the same mistake the menu importer made with "We couldn't read
         * that file", found the same week: a refusal on our side, reported as
         * something the partner could fix by trying harder.
         *
         * It also has a second consequence now. `retryable === false` is what
         * tells the wizard to stop REQUIRING a photo — so with the guard in
         * place, a partner in the wizard would have been refused the upload and
         * then blocked from continuing without one. Trapped, with no way out.
         */
        /* A MISSING upload endpoint is as unretryable as a refused one, and
           for the partner it is the same experience: the photo cannot be
           uploaded, no matter how many times they press. It matters twice over
           now — `retryable === false` is also what lifts the "a photo is
           required" rule, so without this a bench with no `upload_file` would
           demand a photo and refuse every attempt to provide one. */
        if (err?.status === 404) {
          const missing = new Error(
            `We couldn’t upload ${file.name} — that isn’t working here at the moment, ` +
              `which is our problem and not yours. There’s nothing wrong with your photo, ` +
              `and you can carry on without it.`,
          )
          missing.retryable = false
          missing.blocksUpload = true
          missing.cause = err
          throw missing
        }

        if (isAttachPermissionError(err)) {
          const refused = new Error(
            venueId
              ? `We couldn’t attach ${file.name} to this venue — the app isn’t allowed to, ` +
                `which is our problem and not yours. Nothing you’ve done is lost.`
              : `We couldn’t upload ${file.name} — the app isn’t allowed to right now, ` +
                `which is our problem and not yours. There’s nothing wrong with your photo, ` +
                `and you can carry on without it.`,
          )
          refused.retryable = false
          /* Uploading is not available to this partner at all — see the note on
             `blocksUpload` below. */
          refused.blocksUpload = true
          refused.cause = err
          throw refused
        }
        throw err
      }

      return {
        /**
         * ⚠️ 23 Aug, from the live site: the two upload endpoints name the
         * File docname DIFFERENTLY. Core `upload_file` returns it as `name`;
         * `upload_venue_photo` returns it as `file` (and no `name` at all).
         * Reading only `name` left every photo uploaded through the attaching
         * path with `name: undefined` — which `photoRow` forwarded as
         * `file: undefined`, and `set_venue_photos` refused the whole save
         * with a 417: "Each photo needs a `file` (the File docname)".
         */
        name: uploaded.name || uploaded.file,
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

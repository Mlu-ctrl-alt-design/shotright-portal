import axios from 'axios'

/**
 * Fixtures are a LOCAL DEVELOPMENT AFFORDANCE ONLY.
 *
 * Gated on `import.meta.env.DEV`, not on the env var alone. A deployed build
 * must never be able to serve fixture data whatever is set in the hosting
 * dashboard — that is precisely the failure this replaces: the Vercel
 * deployment carried `VITE_USE_MOCKS=true`, so partners were shown invented
 * venues out of `mockBackend.js` with nothing on screen to say so.
 *
 * The default is inverted too. It used to be "mocks unless explicitly off", so
 * a missing or misspelt variable silently produced fake data. It is now "real
 * unless explicitly on, and only in dev": a missing variable now fails
 * visibly instead of lying convincingly.
 *
 * To use fixtures locally:  VITE_USE_MOCKS=true npm run dev
 */
export const USE_MOCKS = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true'

/**
 * Transport for the `shotright` Frappe app at shotright.thedaystar.co.za.
 *
 * AUTH IS TOKEN-BASED, NOT COOKIE-BASED. `shotright.api.login` returns a
 * reusable `api_key`/`api_secret` pair, sent on every later request as
 *
 *     Authorization: token <api_key>:<api_secret>
 *
 * That is a different model to a normal Frappe portal, and it has consequences
 * worth stating rather than discovering later:
 *
 *  - No session cookie, so no CSRF token and no SameSite problem. The
 *    `Domain=` attribute risk called out in the deployment notes does not apply.
 *  - The credential is a long-lived bearer secret. It lives in sessionStorage,
 *    not localStorage, so it dies with the tab rather than persisting on a
 *    shared machine. It is still readable by any script on the origin — the
 *    real mitigation is that the portal ships no third-party scripts and has a
 *    strict CSP. Treat introducing either as a security change.
 *  - "Remember me" cannot be honoured across a browser restart without moving
 *    the secret to localStorage. It currently persists for the tab only.
 */
const api = axios.create({
  // Empty in dev so calls are same-origin and ride the Vite proxy; empty in
  // production too, because vercel.json proxies /api to the bench.
  baseURL: import.meta.env.VITE_API_BASE || '',
  headers: { 'Content-Type': 'application/json' },
})

const TOKEN_KEY = 'shotright.token'

let authToken = null
try {
  authToken = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null')
} catch {
  authToken = null
}

/** Store `{api_key, api_secret}` (or null to sign out). */
export const setAuthToken = (token) => {
  authToken = token && token.api_key && token.api_secret ? token : null
  try {
    if (authToken) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(authToken))
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Private-mode Safari throws on write; the in-memory copy still works for
    // this tab, so a failure here must not break login.
  }
}

export const getAuthToken = () => authToken
export const hasAuthToken = () => Boolean(authToken)

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `token ${authToken.api_key}:${authToken.api_secret}`
  }
  return config
})

/**
 * When to throw the partner out.
 *
 * 401 means the token is no longer usable. Drop it and let the router bounce to
 * /login rather than leaving the UI stuck on a permanently-failing query.
 *
 * ⚠️ 403 USED TO DO THE SAME, AND THAT WAS WRONG. Frappe returns 403 for two
 * unrelated things: "we don't know who you are" and "we know exactly who you
 * are, and this particular row isn't yours to read". The second is ordinary and
 * expected — the photo read falls back to listing File rows, and a bench that
 * won't let the Vendor role list File is being sensibly configured, not broken.
 *
 * Treating that as a dead session logged people out of the portal from a
 * BACKGROUND read they never asked for. They would open a venue and land on the
 * login screen, with the work they were mid-way through gone. A peripheral
 * permission check must never be able to end someone's session.
 *
 * So: 401 always ends it. 403 only when the body actually says authentication —
 * Frappe names `AuthenticationError` / `SessionExpired` for those, and uses
 * `PermissionError` for the ordinary kind.
 *
 * 417 is Frappe's ValidationError status — a real, actionable error (for
 * example the Surprise Me rate limit), NOT an auth failure. It never clears the
 * token.
 */
const AUTH_EXC = /AuthenticationError|SessionExpired|CSRFTokenError/i

const endsSession = (status, data) => {
  if (status === 401) return true
  if (status !== 403) return false
  const exc = `${data?.exc_type || ''} ${data?.exception || ''}`
  // An unlabelled 403 is ambiguous. We keep the session: the cost of being
  // wrong is one failing query, against losing someone's half-finished venue.
  return AUTH_EXC.test(exc)
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    if (
      endsSession(status, error.response?.data) &&
      !window.location.pathname.startsWith('/login')
    ) {
      setAuthToken(null)
      window.dispatchEvent(new CustomEvent('shotright:session-expired'))
    }
    return Promise.reject(normalizeError(error))
  },
)

/**
 * Frappe buries the useful message in a few different places depending on
 * whether the failure came from frappe.throw, a validation error, or the
 * server erroring outright. Flatten that into a plain Error.
 */
export function normalizeError(error) {
  const data = error.response?.data
  let message = data?._server_messages
    ? safeFirstServerMessage(data._server_messages)
    : data?.message || data?.exc_type || error.message

  if (!message) message = 'Something went wrong. Please try again.'
  const normalized = new Error(message)
  normalized.status = error.response?.status
  // Kept because a 404 is ambiguous on Frappe: a MISSING METHOD and a MISSING
  // DOCUMENT both come back as DoesNotExistError with the same status, and the
  // two need completely different things said to a partner. Only the raw body
  // can tell them apart — see `isMethodMissing`.
  normalized.excType = data?.exc_type || null
  normalized.detail = [data?.exception, data?.message, data?.exc].filter(Boolean).join(' ')
  normalized.original = error
  return normalized
}

/**
 * Did the bench 404 because the ENDPOINT is not there, rather than because the
 * thing we asked for is not there?
 *
 * Worth distinguishing. Every wrong-endpoint bug on this project has reached a
 * partner as some flavour of "not found", which reads as "your data is gone" —
 * the most alarming possible way to report a deployment gap. Frappe names the
 * method it could not resolve in the exception text, so when it does, we can say
 * "this part of the portal is not on your server yet" instead of frightening
 * someone about their own menu.
 */
export function isMethodMissing(error, method) {
  if (error?.status !== 404) return false
  const detail = `${error.detail || ''} ${error.message || ''}`
  return (
    /Method Not Found|ModuleNotFoundError|AttributeError|not whitelisted/i.test(detail) ||
    (Boolean(method) && detail.includes(method))
  )
}

function safeFirstServerMessage(raw) {
  try {
    const messages = JSON.parse(raw)
    const first = JSON.parse(messages[0])
    return first.message || first
  } catch {
    return null
  }
}

/** Call a whitelisted method. Frappe wraps the return value in `message`. */
export const call = (method, params = {}, config = {}) =>
  api.post(`/api/method/${method}`, params, config).then((r) => r.data.message)

export const callGet = (method, params = {}) =>
  api.get(`/api/method/${method}`, { params }).then((r) => r.data.message)

export default api

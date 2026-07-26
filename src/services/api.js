import axios from 'axios'

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'

const api = axios.create({
  // Empty in dev so calls are same-origin and ride the Vite proxy.
  baseURL: import.meta.env.VITE_API_BASE || '',
  // Frappe portals authenticate with a session cookie, not a bearer token —
  // this is what actually carries the login between requests.
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// Frappe requires a CSRF token on write requests. It is injected into the page
// as `window.csrf_token` when Frappe serves the HTML — which it does NOT do for
// a decoupled SPA, so we also accept one captured at login and stored here.
let csrfToken = null
export const setCsrfToken = (token) => {
  csrfToken = token || null
}

api.interceptors.request.use((config) => {
  const token = csrfToken || window.csrf_token
  if (token && config.method !== 'get') {
    config.headers['X-Frappe-CSRF-Token'] = token
  }
  return config
})

/**
 * Frappe reports auth failures as 401/403, and a stale CSRF token as 417.
 * Anything in that set means the session is no longer usable, so we clear it
 * and let the router bounce the user to /login rather than leaving the UI
 * stuck on a permanently-failing query.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    if ([401, 403, 417].includes(status) && !window.location.pathname.startsWith('/login')) {
      csrfToken = null
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
  let message =
    data?._server_messages
      ? safeFirstServerMessage(data._server_messages)
      : data?.message || data?.exc_type || error.message

  if (!message) message = 'Something went wrong. Please try again.'
  const normalized = new Error(message)
  normalized.status = error.response?.status
  normalized.original = error
  return normalized
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

/** Call a whitelisted Frappe method. Frappe wraps results in `message`. */
export const call = (method, params = {}, config = {}) =>
  api.post(`/api/method/${method}`, params, config).then((r) => r.data.message)

export const callGet = (method, params = {}) =>
  api.get(`/api/method/${method}`, { params }).then((r) => r.data.message)

export default api

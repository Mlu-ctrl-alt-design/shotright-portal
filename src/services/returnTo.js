/**
 * Where to go after signing in, when that is not the dashboard.
 *
 * Router state (`location.state.from`) already carries this for a plain login,
 * but it does not survive the longer roads: register → verify email, or Google
 * → business name → verify. A partner who followed a claim link from the app
 * and had to create an account on the way must still land back on their claim,
 * not on an empty dashboard wondering where it went.
 *
 * sessionStorage, not localStorage: it is a detour for this tab, and a stale
 * one left behind on a shared machine would send the next person somewhere odd.
 * Only in-app paths are accepted, so this can never become an open redirect.
 */
const KEY = 'shotright.returnTo'

const safe = (path) => (typeof path === 'string' && /^\/(?!\/)/.test(path) ? path : null)

export function rememberReturnTo(path) {
  try {
    if (safe(path)) sessionStorage.setItem(KEY, path)
  } catch {
    // Private-mode Safari: the partner lands on the dashboard instead. Not worth
    // failing a sign-in over.
  }
}

/** Read AND forget — a return path is used once. */
export function takeReturnTo(fallback = '/') {
  try {
    const path = safe(sessionStorage.getItem(KEY))
    sessionStorage.removeItem(KEY)
    return path || fallback
  } catch {
    return fallback
  }
}

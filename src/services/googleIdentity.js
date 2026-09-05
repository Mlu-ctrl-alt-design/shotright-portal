/**
 * Google Identity Services, loaded only if we are actually going to use it.
 *
 * WHAT THIS DOES AND DOES NOT DO. It obtains a signed ID token from Google and
 * hands it to the bench. It never decides who anybody is: the token is a claim,
 * and the only party that can check the signature against Google's keys is the
 * server. Nothing here reads the token's contents, and nothing downstream of
 * here should either — a JWT is trivially forged by whoever holds the console.
 *
 * THE CLIENT ID IS PUBLIC. Unlike the Places REST key, an OAuth client id is
 * meant to sit in a page; it is restricted by authorised JavaScript origins, so
 * a copy taken out of the bundle is useless on any other domain. It is the one
 * Google credential that belongs in the browser.
 */

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

const SRC = 'https://accounts.google.com/gsi/client'

let loading = null

/**
 * Resolves the `google.accounts.id` namespace, or null.
 *
 * Never throws and never rejects. A blocked script, an offline partner, an ad
 * blocker that eats Google domains, or no client id configured are all ordinary
 * outcomes, and every one of them means the same thing to the caller: this way
 * in is not available, carry on with the password form.
 */
export function loadGoogleIdentity() {
  if (!GOOGLE_CLIENT_ID) return Promise.resolve(null)
  if (typeof document === 'undefined') return Promise.resolve(null)
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (loading) return loading

  loading = new Promise((resolve) => {
    const done = () => resolve(window.google?.accounts?.id || null)

    const existing = document.querySelector(`script[src="${SRC}"]`)
    if (existing) {
      existing.addEventListener('load', done, { once: true })
      existing.addEventListener('error', () => resolve(null), { once: true })
      // Already finished loading before we attached: the listeners never fire.
      if (window.google?.accounts?.id) done()
      return
    }

    const script = document.createElement('script')
    script.src = SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', done, { once: true })
    script.addEventListener('error', () => resolve(null), { once: true })
    document.head.appendChild(script)
  })

  return loading
}

/** Test seam — lets a suite reset the one-shot loader between cases. */
export const __resetGoogleIdentity = () => {
  loading = null
}

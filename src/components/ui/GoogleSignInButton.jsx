import { useEffect, useRef, useState } from 'react'
import { GOOGLE_CLIENT_ID, loadGoogleIdentity } from '../../services/googleIdentity'
import { googleAuthSupported } from '../../services/vendor'

/**
 * "Continue with Google", when there is somewhere for it to go.
 *
 * ⚠️ RENDERS NOTHING until three things are true: a client id is configured,
 * Google's script actually loaded, and the bench has an endpoint that can
 * exchange the token. A sign-in button that cannot sign anyone in is worse than
 * no button — it is the most trusted control on the page, and a partner who
 * presses it and fails does not conclude "that feature isn't ready", they
 * conclude the portal is broken and stop.
 *
 * The button itself is Google's own, rendered by their library into the div
 * below rather than drawn by us. Their branding terms are specific about the
 * mark, the wording and the proportions, and an approximation of someone else's
 * logo is not ours to ship.
 */
export default function GoogleSignInButton({ onCredential, label = 'signin_with', disabled }) {
  const holder = useRef(null)
  const callback = useRef(onCredential)
  const [ready, setReady] = useState(false)

  // Kept in a ref so re-initialising Google's widget is never necessary just
  // because the parent re-rendered with a new closure.
  useEffect(() => {
    callback.current = onCredential
  }, [onCredential])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (!GOOGLE_CLIENT_ID) return
      // Asked in parallel: neither answer is useful without the other, and the
      // script is a third-party fetch we would rather not serialise behind ours.
      const [identity, supported] = await Promise.all([
        loadGoogleIdentity(),
        googleAuthSupported().catch(() => false),
      ])
      if (cancelled || !identity || !supported || !holder.current) return

      identity.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => callback.current?.(response?.credential),
      })
      identity.renderButton(holder.current, {
        theme: 'outline',
        size: 'large',
        text: label,
        shape: 'pill', // the portal's own button shape
        width: 320,
      })
      setReady(true)
    })()

    return () => {
      cancelled = true
    }
  }, [label])

  if (!GOOGLE_CLIENT_ID) return null

  return (
    <div className={ready ? 'flex flex-col items-center gap-4' : 'sr-only'}>
      {ready && (
        <div className="flex w-full items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-ink-200" />
          <span className="text-xs font-medium text-ink-500">or</span>
          <span className="h-px flex-1 bg-ink-200" />
        </div>
      )}
      {/* Google writes its own button in here. `inert` while the form is busy,
          so a second identity cannot be chosen mid-login. */}
      <div ref={holder} className={disabled ? 'pointer-events-none opacity-50' : undefined} />
    </div>
  )
}

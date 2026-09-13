import { useEffect, useState } from 'react'

/**
 * Is this a phone-width screen?
 *
 * ⚠️ WHY A HOOK AND NOT `sm:hidden`. Tailwind's breakpoints are CSS, so both
 * layouts would be in the DOM and the browser would hide one — which is fine
 * for a browser and wrong twice over here. It doubles every venue row, and it
 * leaves the test suite (which deliberately does not compile Tailwind) finding
 * two of every link and unable to tell which one a partner would press.
 *
 * 640px is Tailwind's own `sm`, written out rather than imported so the two
 * cannot drift silently — if this number changes, the class names beside it
 * must change with it.
 *
 * Defaults to NOT-a-phone. A server, a test environment, or a browser with no
 * `matchMedia` gets the table, which is the layout that has always been there
 * — a new feature should not be able to take the old one away by failing.
 */
const PHONE = '(max-width: 639px)'

export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(PHONE).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(PHONE)
    const onChange = (e) => setIsPhone(e.matches)
    setIsPhone(mq.matches) // a rotation between render and effect
    // Safari below 14 has no addEventListener on a MediaQueryList.
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  return isPhone
}

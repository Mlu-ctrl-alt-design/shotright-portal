import { useEffect, useRef, useState } from 'react'

/**
 * The device-location signal (spec §2, §5).
 *
 * Two uses, and they are deliberately different in kind: biasing the address
 * autocomplete toward the partner's area, and dropping a PROVISIONAL map pin
 * before any address is chosen.
 *
 * THE 8-SECOND WINDOW (§5). A fix inside 8s is treated as prompt and both uses
 * apply. A fix after 8s — or after the partner has started typing an address —
 * still drops the pin, but the suggestion list is NOT re-sorted, because
 * reordering a list somebody is actively reading is disorienting. `prompt`
 * below carries that distinction; the address field reads it and stops applying
 * bias once it is false.
 *
 * A STALE FIX IS NOT A FIX (§4). `maximumAge` is capped at 5 minutes: a
 * position cached from wherever the phone was earlier is worse than nothing,
 * because it looks equally confident.
 *
 * FAILURE IS NORMAL, NOT EXCEPTIONAL. Denied, timed out, unsupported, or simply
 * never resolving are all ordinary outcomes, and the form has to be fully usable
 * in every one of them. There are eight combinations of the three signals and
 * this hook must not assume the happy path for its own.
 */
const PROMPT_WINDOW_MS = 8000
const MAX_AGE_MS = 5 * 60 * 1000

export function useDeviceLocation({ enabled = true } = {}) {
  const [state, setState] = useState({
    coords: null,
    status: 'idle', // idle | pending | granted | denied | unavailable
    prompt: true, // did it arrive inside the 8s window?
  })

  // Set the moment the partner touches the address field. A fix arriving after
  // that must not re-sort what they are reading, even if it is inside 8s.
  const interacted = useRef(false)
  const markInteracted = () => {
    interacted.current = true
  }

  useEffect(() => {
    if (!enabled) return
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, status: 'unavailable' }))
      return
    }

    let cancelled = false
    const startedAt = Date.now()
    setState((s) => ({ ...s, status: 'pending' }))

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        const elapsed = Date.now() - startedAt
        setState({
          coords: {
            latitude: Number(position.coords.latitude.toFixed(6)),
            longitude: Number(position.coords.longitude.toFixed(6)),
            accuracy: position.coords.accuracy,
          },
          status: 'granted',
          prompt: elapsed <= PROMPT_WINDOW_MS && !interacted.current,
        })
      },
      () => {
        if (cancelled) return
        // Denied, timed out and position-unavailable are one outcome as far as
        // this form is concerned: no signal, carry on without it.
        setState({ coords: null, status: 'denied', prompt: false })
      },
      { enableHighAccuracy: true, timeout: PROMPT_WINDOW_MS, maximumAge: MAX_AGE_MS },
    )

    return () => {
      cancelled = true
    }
  }, [enabled])

  return { ...state, markInteracted }
}

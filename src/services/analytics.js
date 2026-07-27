/**
 * Event sink for the smart-defaults instrumentation (handoff spec §12).
 *
 * There is no analytics provider wired into this portal, and inventing one
 * would be a decision this file has no business making. `track()` therefore
 * buffers events and re-emits them as a DOM CustomEvent, which is the smallest
 * thing that is genuinely useful: a provider is added later by listening for
 * `shotright:analytics` in one place, with no call sites to change.
 *
 * ⚠️ UNTIL THAT LISTENER EXISTS, NOTHING IS RECORDED ANYWHERE. The spec's
 * acceptance-rate metric — "any field falling below 70% acceptance should have
 * its default reconsidered" — cannot be evaluated, and neither can the A/B in
 * §12. The events are correct and complete; the destination is missing. That is
 * a deliberate gap, not an oversight.
 */

const BUFFER_LIMIT = 200
const buffer = []

/**
 * Record an event.
 *
 * Never throws. Instrumentation that can break the feature it measures is worse
 * than no instrumentation, and a failed dispatch must not stop a partner
 * listing their venue.
 */
export function track(event, properties = {}) {
  const payload = { event, ...properties }

  try {
    buffer.push(payload)
    if (buffer.length > BUFFER_LIMIT) buffer.shift()

    if (import.meta.env.DEV) console.debug('[analytics]', event, properties)
    window.dispatchEvent(new CustomEvent('shotright:analytics', { detail: payload }))
  } catch {
    // Deliberately silent.
  }
}

/** Test seam — lets a test assert on what was emitted. */
export const __analyticsBuffer = () => [...buffer]

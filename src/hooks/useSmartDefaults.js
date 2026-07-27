import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProfile, usePopularVenueOptions } from './useVendor'
import { useDeviceLocation } from './useDeviceLocation'
import { track } from '../services/analytics'
import {
  FIELD_MATRIX,
  TIER,
  TIER_B_FIELDS,
  announcementFor,
  clearDismissalStreak,
  computeDefaults,
  recordDismissal,
  smartDefaultsEnabled,
  suppressedFields,
} from '../services/smartDefaults'

/**
 * Owns smart-default state for the venue details step.
 *
 * ⚠️ CALL THIS ABOVE THE STEP, not inside it. Wizard steps unmount when you
 * navigate away — going to "operating hours" and back would reset dirty flags
 * held in the step, and the defaults would then re-apply straight over the
 * partner's edits. §6 requires a dirty field to stay excluded "for the
 * remainder of the session", and §9 names re-entry after a validation failure
 * as the most common bug in this pattern. Both are the same requirement: this
 * state must outlive the component that renders it.
 *
 * Returns everything the step and the wizard's Continue gate need, and nothing
 * else — the step stays a rendering concern.
 */
export function useSmartDefaults({ values, onChange }) {
  const { data: profile } = useProfile()
  const { data: popular } = usePopularVenueOptions()
  const location = useDeviceLocation()

  const accountKey = profile?.email || 'anonymous'
  const enabled = useMemo(() => smartDefaultsEnabled(accountKey), [accountKey])

  /** field -> {value, source, tier, label, share}. Only unmodified defaults. */
  const [applied, setApplied] = useState({})
  const [confirmed, setConfirmed] = useState(() => new Set())
  const [announcement, setAnnouncement] = useState('')

  // Refs, not state: these are read during event handling and must never
  // trigger a render or go stale inside a closure.
  const dirty = useRef(new Set())
  const appliedOnce = useRef(false)
  const pinDropped = useRef(false)
  const valuesRef = useRef(values)
  valuesRef.current = values

  /** True while the pin is the device guess rather than a real address. */
  const [pinIsProvisional, setPinIsProvisional] = useState(false)

  /**
   * Single application pass (§5).
   *
   * Guarded by `appliedOnce` so the form never fills in staggered bursts, and
   * so a re-render from any other cause cannot re-apply over an edit. Geolocation
   * is the documented exception and is handled separately — it does not flow
   * through here.
   */
  useEffect(() => {
    if (!enabled || appliedOnce.current) return
    // Profile is the synchronous-ish signal that gates the pass; popularity may
    // legitimately be absent forever (no endpoint), so it is not waited on.
    if (profile === undefined) return

    const skip = new Set([...dirty.current, ...suppressedFields(accountKey)])
    const next = computeDefaults({ profile, popular, values: valuesRef.current, skip })
    appliedOnce.current = true

    if (!Object.keys(next).length) return

    setApplied(next)
    onChange({
      ...valuesRef.current,
      ...Object.fromEntries(Object.entries(next).map(([key, d]) => [key, d.value])),
    })
    setAnnouncement(announcementFor(next))

    for (const [field, d] of Object.entries(next)) {
      track('default_applied', { field, source: d.source, tier: d.tier })
    }
    // onChange identity is not stable across the wizard's renders; including it
    // would re-run this pass. `appliedOnce` makes that harmless, but leaving it
    // out keeps the intent legible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, profile, popular, accountKey])

  /**
   * The provisional pin (§4, §5).
   *
   * Asynchronous, so it does NOT go through the single application pass above.
   * It drops whenever a fix arrives, early or late — only the address bias is
   * withheld after 8 seconds.
   *
   * Guarded on the coordinates being empty, checked at the moment of
   * application rather than at mount: a fix that resolves after the partner has
   * already picked an address must not move the pin off it. This is the exact
   * case §5 means by "a late-arriving signal must never overwrite a field the
   * manager has touched".
   */
  useEffect(() => {
    if (!enabled || pinDropped.current) return
    if (!location.coords) return

    const current = valuesRef.current
    if (Number.isFinite(current.latitude) || Number.isFinite(current.longitude)) {
      pinDropped.current = true
      return
    }

    pinDropped.current = true
    setPinIsProvisional(true)
    onChange({
      ...current,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    })
    track('default_applied', { field: 'map_pin', source: 'location', tier: 'B' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, location.coords])

  /** The pin stopped being a guess — either dragged, typed, or address-derived. */
  const onPinMoved = useCallback(() => setPinIsProvisional(false), [])

  /**
   * Mark a field as user-touched.
   *
   * Once dirty, a field is permanently excluded from default application. The
   * chip disappears silently — no toast, no explanation — because the partner
   * has just demonstrated they know what they want (§6).
   */
  const markDirty = useCallback((field) => {
    if (dirty.current.has(field)) return
    dirty.current.add(field)

    setApplied((prev) => {
      if (!prev[field]) return prev
      track('default_edited', { field, source: prev[field].source })
      clearDismissalStreak(accountKey, field)
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [accountKey])

  /**
   * Chip ✕ — clear the field and hand focus back so they can type immediately.
   *
   * The address chip is a CONFIRMATION notice rather than a default, so it is
   * not routed here: dismissing it must not clear work the partner did. See
   * `AddressAutocomplete`.
   */
  const dismiss = useCallback(
    (field) => {
      const entry = applied[field]
      dirty.current.add(field)

      setApplied((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
      onChange({ ...valuesRef.current, [field]: '' })

      track('default_dismissed', { field, source: entry?.source })
      if (recordDismissal(accountKey, field)) {
        track('default_suppressed_for_account', { field })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [applied, accountKey, onChange],
  )

  /** Tier B acknowledgement — "yes, that is the number customers should call". */
  const confirm = useCallback((field) => {
    setConfirmed((prev) => new Set(prev).add(field))
    track('default_confirmed', { field })
  }, [])

  /**
   * Tier B fields still holding an unconfirmed default.
   *
   * A field the partner edited is not unconfirmed — editing IS confirmation,
   * per §3 ("edited the value OR explicitly acknowledged it").
   */
  const unconfirmed = TIER_B_FIELDS.filter(
    (field) => applied[field] && !confirmed.has(field) && !dirty.current.has(field),
  )

  // A provisional pin is Tier B too, and the highest-stakes one on the form:
  // a venue pinned to wherever the manager happened to be standing is a venue
  // customers cannot find. It leaves this list the moment the pin is moved or
  // an address is chosen.
  const blockers = pinIsProvisional ? [...unconfirmed, 'map_pin'] : unconfirmed

  /** Emitted at submit so acceptance rate (§12) is measurable per field. */
  const reportAccepted = useCallback(() => {
    for (const [field, d] of Object.entries(applied)) {
      track('default_accepted', { field, source: d.source, tier: d.tier })
    }
  }, [applied])

  return {
    enabled,
    applied,
    announcement,
    unconfirmed: blockers,
    confirmed,
    location,
    pinIsProvisional,
    onPinMoved,
    isDefaulted: (field) => Boolean(applied[field]),
    tierOf: (field) => FIELD_MATRIX[field]?.tier ?? TIER.NEVER,
    markDirty,
    dismiss,
    confirm,
    reportAccepted,
  }
}

import { lazy, Suspense, useEffect, useId, useRef } from 'react'
import { useVenueLookups } from '../../../../hooks/useVendor'
import { Input, Select } from '../../../../components/ui'
import Spinner from '../../../../components/ui/Spinner'
import AddressAutocomplete from '../../../../components/ui/AddressAutocomplete'
import DefaultChip, { ChipRow } from '../../../../components/ui/DefaultChip'
import { CHIP_COPY, SOURCE, TIER } from '../../../../services/smartDefaults'

const RichTextEditor = lazy(() => import('../../../../components/ui/RichTextEditor'))
const MapPicker = lazy(() => import('../../../../components/ui/MapPicker'))

/**
 * Wizard step 2 — venue details, with smart defaults.
 *
 * Field order and grouping follow `venue details filled.png`: the venue name on
 * its own, then manager name / surname, then cellphone / address, then the two
 * dropdowns, then the long-form description.
 *
 * Note the two selects are *different* fields — dress code and atmosphere. The
 * review screen in the designs labels both "Dress code", which is a design bug
 * rather than a spec (see the PRD appendix).
 *
 * SMART DEFAULTS (handoff spec, 27 Jul 2026). This step renders them; it does
 * not own them — `useSmartDefaults` is called in `VenueWizard` so dirty flags
 * survive stepping away and back. See that hook for why.
 *
 * Autofocus lands on the venue name (§11): it is the only field we could not
 * fill, and per the spec that focus IS the user-facing payoff of the feature.
 */
export default function VenueDetailsStep({
  value,
  onChange,
  defaults,
  errors = {},
  onBlurField = () => {},
}) {
  const { data: lookups, isLoading } = useVenueLookups()
  const nameRef = useRef(null)
  const chipIds = useId()

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  /**
   * Every change marks the field dirty BEFORE the value lands, so a default can
   * never be re-applied over an edit that is still in flight.
   */
  const set = (key) => (e) => {
    defaults.markDirty(key)
    onChange({ ...value, [key]: e.target.value })
  }

  const chipIdFor = (field) => `${chipIds}-${field}`

  /**
   * On first focus of a defaulted field, select the whole value so typing
   * replaces rather than appends (§8). Only on the first focus — stealing the
   * selection every time would fight anyone trying to edit one character.
   */
  /**
   * Field nodes, so dismissing a chip can hand focus back (§6: "returns focus
   * to the now-empty input so they can type immediately").
   *
   * Without this the ✕ clears the value and drops focus to the document, so the
   * partner has to go and find the field they just emptied — which makes
   * removing a guess cost MORE than typing over it would have, inverting the
   * spec's second principle.
   */
  const nodes = useRef({})
  const captureNode = (field) => (node) => {
    if (node) nodes.current[field] = node
    else delete nodes.current[field]
  }

  const dismissAndFocus = (field) => {
    defaults.dismiss(field)
    // After the re-render that clears the value, not before.
    requestAnimationFrame(() => nodes.current[field]?.focus())
  }

  const selectedOnce = useRef(new Set())
  const onFocusDefaulted = (field) => (e) => {
    if (!defaults.isDefaulted(field) || selectedOnce.current.has(field)) return
    selectedOnce.current.add(field)
    e.target.select()
  }

  /** The chip beneath a defaulted field, or nothing — the row keeps its height. */
  const chipFor = (field, fieldLabel) => {
    const entry = defaults.applied[field]
    if (!entry) return <ChipRow />

    const tone = entry.source === SOURCE.POPULAR ? 'popular' : 'profile'
    const copy =
      entry.source === SOURCE.POPULAR
        ? CHIP_COPY.popular(entry.share)
        : CHIP_COPY[SOURCE.PROFILE]

    return (
      <ChipRow>
        <DefaultChip
          id={chipIdFor(field)}
          tone={tone}
          onDismiss={() => dismissAndFocus(field)}
          dismissLabel={`Clear default ${fieldLabel}`}
          // Tier B carries its acknowledgement in the chip, next to the value
          // it is about, rather than as a separate checkbox further down.
          needsConfirm={entry.tier === TIER.CONFIRM && !defaults.confirmed.has(field)}
          onConfirm={() => defaults.confirm(field)}
          confirmLabel="Yes, use this"
        >
          {copy}
        </DefaultChip>
      </ChipRow>
    )
  }

  /** Props shared by every field that participates in defaulting. */
  const fieldProps = (field) => ({
    ref: captureNode(field),
    value: value[field],
    onChange: set(field),
    onFocus: onFocusDefaulted(field),
    // Validate on BLUR, not on keystroke. Telling someone their phone number is
    // wrong while they are typing the third digit is hostile; telling them when
    // they leave the field is help. Once a field is touched it re-validates on
    // every change, so the error clears the moment it is fixed.
    onBlur: () => onBlurField(field),
    error: errors[field],
    // Reserve the message line so revealing an error on blur reflows nothing —
    // see the note in `Input`. Without it, blurring a field while clicking Next
    // moves the button between mousedown and mouseup and swallows the click.
    reserveMessage: true,
    prefilled: defaults.isDefaulted(field),
    // §11 — the chip text is the field's description, so a screen reader
    // announces where the value came from instead of presenting a mysteriously
    // populated field.
    'aria-describedby': defaults.isDefaulted(field) ? chipIdFor(field) : undefined,
    'data-default-source': defaults.applied[field]?.source,
    'data-field': field,
  })

  return (
    <div className="space-y-4">
      {/* One polite announcement for the whole batch (§11). Announcing each
          field separately teaches people to tune the region out. */}
      <p className="sr-only" role="status" aria-live="polite">
        {defaults.announcement}
      </p>

      <div className="sm:w-1/2 sm:pr-3">
        <Input
          ref={nameRef}
          aria-label="Venue name"
          placeholder="Please type in your venue name"
          required
          value={value.venue_name}
          onChange={set('venue_name')}
          onBlur={() => onBlurField('venue_name')}
          error={errors.venue_name}
          reserveMessage
          data-field="venue_name"
        />
        {/* Tier D — never defaulted, but the row still reserves its height so
            this field's neighbours do not sit at a different rhythm. */}
        <ChipRow />
      </div>

      <div className="grid gap-x-6 sm:grid-cols-2">
        <div>
          <Input
            aria-label="Manager name"
            placeholder="Please type in manager name"
            {...fieldProps('manager_name')}
          />
          {chipFor('manager_name', 'manager name')}
        </div>

        <div>
          <Input
            aria-label="Manager surname"
            placeholder="Please type in manager surname"
            {...fieldProps('manager_surname')}
          />
          {chipFor('manager_surname', 'manager surname')}
        </div>

        <div>
          <Input
            type="tel"
            inputMode="tel"
            aria-label="Contact number"
            placeholder="Please type in contact number"
            {...fieldProps('contact_number')}
          />
          {chipFor('contact_number', 'contact number')}
        </div>

        <div>
          <AddressAutocomplete
            value={value.address}
            onChange={(patch) => {
              // Choosing an address supersedes the device guess: the pin is now
              // derived from a real place rather than from where the phone is.
              if (Number.isFinite(patch.latitude)) defaults.onPinMoved?.()
              onChange({ ...value, ...patch })
            }}
            near={defaults.location}
          />
        </div>

        <div>
          <Select
            aria-label="Dress code"
            disabled={isLoading}
            {...fieldProps('dress_code')}
          >
            <option value="">Select a dress code</option>
            {(lookups?.dress_codes ?? []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          {chipFor('dress_code', 'dress code')}
        </div>

        <div>
          <Select
            aria-label="Atmosphere"
            disabled={isLoading}
            {...fieldProps('atmosphere')}
          >
            <option value="">Select an atmosphere</option>
            {(lookups?.atmospheres ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          {chipFor('atmosphere', 'atmosphere')}
        </div>
      </div>

      <Suspense
        fallback={
          <div className="grid min-h-80 place-items-center rounded-3xl border-2 border-field">
            <Spinner label="Loading map…" />
          </div>
        }
      >
        <MapPicker
          latitude={value.latitude}
          longitude={value.longitude}
          address={value.address}
          provisional={defaults.pinIsProvisional}
          error={errors.latitude || errors.longitude}
          onChange={({ latitude, longitude, provisional }) => {
            defaults.onPinMoved?.(provisional)
            onChange({ ...value, latitude, longitude })
          }}
        />
      </Suspense>

      <Suspense
        fallback={
          <div className="grid min-h-56 place-items-center rounded-3xl border-2 border-field">
            <Spinner label="Loading editor…" />
          </div>
        }
      >
        <RichTextEditor
          ariaLabel="Venue description"
          value={value.summary}
          onChange={(summary) => onChange({ ...value, summary })}
          placeholder="Tell customers about your venue — its story, what you are known for, and what makes a night there worth it."
        />
      </Suspense>
    </div>
  )
}

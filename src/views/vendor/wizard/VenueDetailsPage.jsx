import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { useMoods, useVenueLookups } from '../../../hooks/useVendor'
import { Alert, Button, DayChip, Input, Select } from '../../../components/ui'
import Spinner from '../../../components/ui/Spinner'
import AddressAutocomplete from '../../../components/ui/AddressAutocomplete'
import DefaultChip, { ChipRow } from '../../../components/ui/DefaultChip'
import { CHIP_COPY, SOURCE, TIER } from '../../../services/smartDefaults'
import { resolveMood } from '../../../services/vendor'
import { clsx } from '../../../utils/clsx'

const MapPicker = lazy(() => import('../../../components/ui/MapPicker'))

/**
 * The venue form — one scrolling page, six sections, a rail that ticks.
 *
 * This replaced a five-screen wizard on 17 Sep. The complaint it answers was
 * not "too many screens", it was "too many fields at once and no idea how much
 * is left" — so the fix is not fewer questions, it is questions in labelled
 * groups with an honest count beside them.
 *
 * WHAT IS REQUIRED: a name, a manager, a contact number, a location, at least
 * one mood, the days you are open, and one line of description. Everything
 * else is marked optional IN THE LABEL, because a field that looks compulsory
 * and is not costs the same time as one that is.
 *
 * ⚠️ THE DESCRIPTION IS REQUIRED BY THE BACKEND, not by us, and the design
 * marked it optional. `submit_venue_for_review` refuses a venue with an empty
 * one. See `validateWords` — asking for a four-word answer up front beats
 * letting somebody finish and then declining them for it.
 *
 * THE DESCRIPTION IS THREE QUESTIONS, not a blank rich-text box. "Tell
 * customers about your venue" in an empty editor is the single most abandoned
 * control in the old wizard, and the reason is that it asks someone to be a
 * copywriter at the end of a form. Three short questions they can answer in
 * four words each, assembled into the paragraph, gets a usable description out
 * of people who would otherwise have left it blank — and they can see exactly
 * what customers will read before they save.
 */

/* Design order: the week as a partner reads it, not as Date.getDay() numbers
   it. Keys stay the backend's own, so nothing downstream changes. */
const DAYS = [
  { key: 'mon', label: 'MON' },
  { key: 'tue', label: 'TUE' },
  { key: 'wed', label: 'WED' },
  { key: 'thu', label: 'THU' },
  { key: 'fri', label: 'FRI' },
  { key: 'sat', label: 'SAT' },
  { key: 'sun', label: 'SUN' },
]

const PROMPTS = [
  {
    key: 'known',
    id: 'p-known',
    question: 'Known for?',
    placeholder: 'Slow-cooked lamb and a proper fire',
  },
  {
    key: 'night',
    id: 'p-night',
    question: 'A night here?',
    placeholder: 'Long tables, live kwaito, nobody leaves early',
  },
  {
    key: 'who',
    id: 'p-who',
    question: 'Who comes?',
    placeholder: 'Friends after work, families on Sundays',
  },
]

/**
 * Three short answers, assembled into the paragraph a customer reads.
 *
 * The leading-phrase strip matters: people answer "Known for?" with "we are
 * known for our ribs", and pasting that in verbatim produces "Known for we are
 * known for our ribs." Read back to them on screen before they save, so a
 * sentence we assembled badly is theirs to catch.
 */
export function assembleSummary(answers = {}) {
  const bits = []
  if (answers.known) bits.push(`Known for ${answers.known.replace(/^we are known for /i, '')}.`)
  if (answers.night) bits.push(`A night here is ${answers.night.replace(/^it is /i, '')}.`)
  if (answers.who) bits.push(`You will find ${answers.who.replace(/^mostly /i, '')} here.`)
  return bits.join(' ')
}

/** "From your Google listing" / "From your profile" — provenance, per field. */
function SourceChip({ tone = 'import', children }) {
  return (
    <p
      className={clsx(
        'mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        'motion-safe:animate-[chip-in_250ms_ease-out]',
        tone === 'import' ? 'bg-brand-50 text-brand-900' : 'bg-ink-50 text-ink-700',
      )}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-3.5 fill-none stroke-current stroke-2">
        {tone === 'import' ? (
          <>
            <circle cx="10" cy="10" r="7.5" />
            <path d="M2.5 10h15M10 2.5a12 12 0 0 1 0 15 12 12 0 0 1 0-15Z" />
          </>
        ) : (
          <>
            <circle cx="10" cy="7" r="3" />
            <path d="M4 17a6 6 0 0 1 12 0" strokeLinecap="round" />
          </>
        )}
      </svg>
      {children}
    </p>
  )
}

/**
 * "Nothing fits? Suggest one" — closed by default.
 *
 * ⚠️ THIS IS A CAPABILITY THE DESIGN DROPPED, KEPT DELIBERATELY.
 *
 * The old mood step let a partner type a vibe of their own; anything new was
 * filed for the Sho't Right team and attached to the venue as `pending`. The
 * redesign shows chips only, which is right for the 95% — recognition beats
 * recall, and partners could not guess a vocabulary nobody had shown them —
 * but a venue whose whole character is a word we do not stock still has to be
 * able to say so. Deleting a shipped feature because a prototype did not draw
 * it is not a design decision, it is an accident.
 *
 * So it is here, behind one line of text, closed. The request was for less
 * copy; this costs a sentence and keeps the feature.
 *
 * TWO BACKEND STATES, both handled by `resolveMood`:
 *   resolve_mood deployed  new moods come back `suggested` and are attached
 *                          with the pending treatment.
 *   resolve_mood absent    matching runs locally, anything new comes back
 *                          `unmatched`, and it is REFUSED here — because
 *                          `create_venue` rejects moods it does not know, so
 *                          accepting one would fail the save later on.
 */
function SuggestMood({ chosen, onAdd }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  const submit = async (event) => {
    event.preventDefault()
    const input = text.trim()
    if (!input) return
    setBusy(true)
    setProblem(null)
    try {
      const resolved = await resolveMood(input)
      if (resolved.status === 'unmatched') {
        setProblem(
          `Sho’t Right doesn’t have “${input}” yet, and customers search from a set list — so only ` +
            'the vibes above can go on a venue for now.',
        )
        return
      }
      if (chosen.some((m) => m.mood === resolved.mood)) {
        setProblem(`“${resolved.label}” is already on this venue.`)
        return
      }
      onAdd(resolved)
      setText('')
    } catch (err) {
      setProblem(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-[13px] font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900"
      >
        Nothing fits? Suggest a vibe
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-3.5 flex flex-wrap items-start gap-2.5">
      <Input
        shape="field"
        aria-label="Suggest a vibe"
        placeholder="Describe the vibe in a word or two"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-w-56 flex-1"
      />
      <Button shape="field" size="sm" type="submit" loading={busy} className="mt-0.5">
        Add
      </Button>
      {/* Said where it happens rather than as a toast: a mood that is pending is
          attached to the venue and simply not searchable yet, and a partner
          seeing the word needs to know their venue is not broken. */}
      {problem && (
        <p role="alert" className="w-full px-1 text-xs font-medium text-red-700">
          {problem}
        </p>
      )}
      {!problem && (
        <p className="w-full px-1 text-xs text-ink-500">
          A vibe we don’t have yet goes on your venue straight away and starts bringing customers
          in once our team approves it.
        </p>
      )}
    </form>
  )
}

function Section({ id, title, subtitle, first, children }) {
  return (
    <section
      id={id}
      // `scroll-mt` so a rail link does not park the heading under the sticky
      // top of the card, which is where it lands without it.
      className={clsx('scroll-mt-8', first ? 'mt-8' : 'mt-8 border-t border-ink-200 pt-6')}
    >
      {/* An empty <h2> is worse than no heading — a screen reader announces a
          heading level and then nothing. The photos block carries its own. */}
      {title && <h2 className="text-base font-bold text-ink-900">{title}</h2>}
      {subtitle && <p className="mt-1.5 text-[13.5px] text-ink-700">{subtitle}</p>}
      {children}
    </section>
  )
}

export default function VenueDetailsPage({
  value,
  onChange,
  moods,
  onMoodsChange,
  hours,
  onHoursChange,
  answers,
  onAnswersChange,
  /** Detail fields whose value came from an imported listing, not the partner. */
  fromImport = [],
  onClearImportedField = () => {},
  /** Smart-default state, owned above this component. See `useSmartDefaults`. */
  defaults,
  importSource = null,
  errors = {},
  onBlurField = () => {},
  mapOpen,
  onToggleMap,
  /** True while the pin is a rough device guess rather than a real address. */
  pinProvisional = false,
  onPinMoved,
  hoursFromImport = null,
  onEditHours = () => {},
}) {
  const { data: lookups, isLoading: lookupsLoading } = useVenueLookups()
  const { data: canonicalMoods = [] } = useMoods()
  const nameRef = useRef(null)
  const managerRef = useRef(null)
  const contactRef = useRef(null)
  const dressRef = useRef(null)
  const chipIds = useId()

  /**
   * Focus lands on the venue name (spec §11).
   *
   * It is the one field we could never fill in, and per the smart-defaults
   * spec that focus IS the user-facing payoff of the feature: the partner
   * arrives to find everything we could answer already answered, and the
   * cursor sitting in the one thing only they know.
   */
  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const set = (key) => (e) => {
    /* Every change marks the field dirty BEFORE the value lands, so a default
       can never be re-applied over an edit that is still in flight. */
    defaults.markDirty?.(key)
    /* Typing over a prefilled value makes it the partner's own, so the "we
       filled this in" marker has to go with it — a chip that outlives the
       value it describes teaches people to ignore chips. */
    if (fromImport.includes(key)) onClearImportedField(key)
    onChange({ ...value, [key]: e.target.value })
  }

  /**
   * On first focus of a defaulted field, select the whole value so typing
   * replaces rather than appends (§8). Only on the first focus — stealing the
   * selection every time would fight anyone trying to edit one character.
   */
  const selectedOnce = useRef(new Set())
  const selectOnFirstFocus = (field) => (e) => {
    if (!defaults.isDefaulted(field) || selectedOnce.current.has(field)) return
    selectedOnce.current.add(field)
    e.target.select()
  }

  const chipIdFor = (field) => `${chipIds}-${field}`

  /**
   * The smart-default chip beneath a field, or nothing — the row keeps its
   * height either way, so revealing a chip does not put a field at a different
   * rhythm to its neighbours.
   *
   * ⚠️ EVERY DEFAULTED FIELD NEEDS ONE, not just the obvious ones. A Tier B
   * default blocks the save until it is edited or acknowledged, and the
   * acknowledgement lives ON THE CHIP — so a defaulted field without a chip is
   * a gate with no key: the partner is stopped, told to confirm something, and
   * given nothing to confirm it with. That is a dead end, and it is exactly
   * what happened here when only the manager field was wired up.
   */
  const chipFor = (field, fieldLabel, node) => {
    const entry = defaults.applied?.[field]
    if (!entry) return <ChipRow />

    const tone = entry.source === SOURCE.POPULAR ? 'popular' : 'profile'
    const copy =
      entry.source === SOURCE.POPULAR ? CHIP_COPY.popular(entry.share) : CHIP_COPY[SOURCE.PROFILE]

    return (
      <ChipRow>
        <DefaultChip
          id={chipIdFor(field)}
          tone={tone}
          onDismiss={() => {
            defaults.dismiss(field)
            /* After the re-render that clears the value, not before. Without
               this the ✕ empties the field and drops focus to the document, so
               removing a guess costs MORE than typing over it would have —
               which inverts the spec's second principle. */
            requestAnimationFrame(() => node?.current?.focus())
          }}
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
  const defaultedProps = (field) => ({
    prefilled: defaults.isDefaulted(field) || fromImport.includes(field),
    onFocus: selectOnFirstFocus(field),
    // §11 — the chip text is the field's description, so a screen reader
    // announces where the value came from instead of presenting a mysteriously
    // populated field.
    'aria-describedby':
      defaults.isDefaulted(field) || fromImport.includes(field) ? chipIdFor(field) : undefined,
    'data-default-source': defaults.applied?.[field]?.source,
  })

  const chosen = moods.moods || []
  const isChosen = (id) => chosen.some((m) => m.mood === id)
  const toggleMood = (mood) =>
    onMoodsChange({
      ...moods,
      moods: isChosen(mood.name)
        ? chosen.filter((m) => m.mood !== mood.name)
        : [...chosen, { status: 'canonical', mood: mood.name, label: mood.mood_name }],
    })

  const toggleDay = (key) =>
    onHoursChange({
      ...hours,
      days: hours.days.includes(key)
        ? hours.days.filter((d) => d !== key)
        : [...hours.days, key],
    })

  /**
   * ONE pair of times, applied to every day picked.
   *
   * The old form asked for three ranges — week day, weekend, public holiday —
   * and the redesign cut that to one, on the grounds that a venue with
   * different Sunday hours can say so once it is listed and most venues do not.
   * The three ranges are still what the SERVICE layer sends, so nothing
   * downstream changed: the single pair is written to all three.
   *
   * ⚠️ This does lose the ability to set different weekend hours DURING
   * onboarding. That is the design's deliberate trade and it is recoverable —
   * the venue's own edit form still has all three — but it is a real capability
   * that this screen no longer exposes, and worth knowing before it surprises
   * somebody.
   */
  const setTimes = (patch) => {
    const range = { ...hours.weekday, ...patch }
    onHoursChange({ ...hours, weekday: range, weekend: range, publicHoliday: range })
  }

  const summary = assembleSummary(answers)
  const importLabel = importSource === 'google' ? 'From Google' : 'From your listing'

  return (
    <div>
      {/* ONE polite announcement for the whole batch of smart defaults (§11).
          Announcing each field separately teaches people to tune the region
          out — and a form that fills itself in silently is a form a screen
          reader user has no way to know was filled in at all. */}
      <p className="sr-only" role="status" aria-live="polite">
        {defaults.announcement}
      </p>

      {fromImport.length > 0 && (
        <div className="mt-5 rounded-2xl bg-brand-50 px-4 py-3 ring-1 ring-brand-600/30 ring-inset motion-safe:animate-[chip-in_250ms_ease-out]">
          <p className="text-[13.5px] text-brand-900">
            <strong className="font-bold">
              {fromImport.length} {fromImport.length === 1 ? 'field' : 'fields'} filled from that
              listing.
            </strong>{' '}
            Check them — type over anything wrong.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------ basics */}
      <Section id="basics" title="The basics" first>
        <div className="mt-4 grid gap-x-5 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
          <div className="max-w-md [grid-column:1/-1]">
            <Input
              shape="field"
              ref={nameRef}
              label="Venue name"
              aria-label="Venue name"
              placeholder="Please type in your venue name"
              required
              value={value.venue_name}
              onChange={set('venue_name')}
              onBlur={() => onBlurField('venue_name')}
              error={errors.venue_name}
              reserveMessage
              prefilled={fromImport.includes('venue_name')}
              data-field="venue_name"
            />
            {fromImport.includes('venue_name') && <SourceChip>{importLabel}</SourceChip>}
          </div>

          <div>
            <Input
              shape="field"
              ref={managerRef}
              label="Manager"
              aria-label="Manager"
              placeholder="Name and surname"
              value={value.manager}
              onChange={set('manager')}
              onBlur={() => onBlurField('manager')}
              error={errors.manager}
              reserveMessage
              {...defaultedProps('manager')}
              data-field="manager"
            />
            {chipFor('manager', 'manager', managerRef)}
          </div>

          <div>
            <Input
              shape="field"
              ref={contactRef}
              type="tel"
              inputMode="tel"
              label="Contact number"
              aria-label="Contact number"
              placeholder="012 460 1188"
              value={value.contact_number}
              onChange={set('contact_number')}
              onBlur={() => onBlurField('contact_number')}
              error={errors.contact_number}
              reserveMessage
              {...defaultedProps('contact_number')}
              data-field="contact_number"
            />
            {fromImport.includes('contact_number') ? (
              <SourceChip>{importLabel}</SourceChip>
            ) : (
              chipFor('contact_number', 'contact number', contactRef)
            )}
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------- where */}
      <Section
        id="where"
        title="Where you are"
        subtitle="Customers search by what is near them."
      >
        {/* COLLAPSED TO A CONFIRM ROW. The map was the tallest thing on the old
            step and most partners only ever looked at it. Auto-pinned from the
            address, opened only by someone who wants to check it. */}
        <div className="mt-4 flex flex-wrap items-center gap-3.5 rounded-2xl border-2 border-ink-200 px-4 py-3.5">
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="size-5 shrink-0 fill-none stroke-brand-ink stroke-[1.75]"
          >
            <path d="M10 17.5s6-5 6-9.5a6 6 0 1 0-12 0c0 4.5 6 9.5 6 9.5Z" strokeLinejoin="round" />
            {Number.isFinite(value.latitude) ? (
              <path d="m7.5 8 2 2 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <circle cx="10" cy="8" r="2" />
            )}
          </svg>
          <div className="min-w-40 flex-1">
            <p className="text-sm font-semibold break-words text-ink-900">
              {value.address || 'No address yet'}
            </p>
            {/* ⚠️ A PROVISIONAL PIN MUST NOT SAY "pinned from your address".
                It is a guess from the device, and the whole point of the
                smart-defaults Tier B rule is that a value with real-world
                consequences is not presented as settled. A venue pinned to
                wherever the manager happened to be standing is a venue
                customers cannot find. */}
            <p
              className={clsx(
                'mt-0.5 text-xs',
                pinProvisional ? 'font-medium text-brand-900' : 'text-ink-500',
              )}
            >
              {pinProvisional
                ? 'Roughly where you are now, not your venue — please check it.'
                : Number.isFinite(value.latitude)
                  ? 'Pinned from your address.'
                  : 'Add your address and we drop the pin.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleMap}
            aria-expanded={mapOpen}
            aria-controls="where-panel"
            className="shrink-0 p-1.5 text-[13px] font-bold text-brand-ink underline"
          >
            {mapOpen ? 'Done' : Number.isFinite(value.latitude) ? 'Check it' : 'Add address'}
          </button>
        </div>

        {/* The error lives out here rather than inside the collapsed panel: a
            message nobody can see until they expand the thing it is about is
            not a message. */}
        {(errors.latitude || errors.longitude) && !mapOpen && (
          <p role="alert" className="mt-2 px-1 text-xs font-medium text-red-700">
            {errors.latitude || errors.longitude}
          </p>
        )}

        {mapOpen && (
          <div id="where-panel" className="mt-3.5">
            <AddressAutocomplete
              value={value.address}
              onChange={(patch) => {
                /* Choosing an address supersedes the device guess: the pin is
                   now derived from a real place rather than from where the
                   phone is. */
                if (Number.isFinite(patch.latitude)) onPinMoved?.()
                onChange({ ...value, ...patch })
              }}
            />
            <Suspense
              fallback={
                <div className="mt-3 grid min-h-56 place-items-center rounded-2xl border-2 border-field">
                  <Spinner label="Loading map…" />
                </div>
              }
            >
              <div className="mt-3">
                <MapPicker
                  latitude={value.latitude}
                  longitude={value.longitude}
                  address={value.address}
                  provisional={pinProvisional}
                  error={errors.latitude || errors.longitude}
                  onChange={({ latitude, longitude, provisional }) => {
                    onPinMoved?.(provisional)
                    onChange({ ...value, latitude, longitude })
                  }}
                />
              </div>
            </Suspense>
          </div>
        )}
      </Section>

      {/* -------------------------------------------------------------- vibe */}
      <Section id="vibe" title="The vibe" subtitle="Pick every one that fits a normal night.">
        <div
          data-field="moods"
          tabIndex={-1}
          className={clsx(
            'mt-4 flex flex-wrap gap-2.5 rounded-2xl',
            errors.moods && 'p-3 ring-2 ring-red-700',
          )}
        >
          {/* The canonical list, plus anything the partner suggested that is
              not on it. A suggested mood that rendered nowhere would be a vibe
              they added, cannot see, and cannot remove — and it would still be
              sent at save. */}
          {[
            ...canonicalMoods,
            ...chosen
              .filter((m) => !canonicalMoods.some((c) => c.name === m.mood))
              .map((m) => ({ name: m.mood, mood_name: m.label, pending: true })),
          ].map((mood) => {
            const on = isChosen(mood.name)
            return (
              <button
                key={mood.name}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMood(mood)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
                  on
                    ? 'bg-deep-500 text-ink-900'
                    : 'bg-white text-brand-ink ring-2 ring-field ring-inset hover:bg-brand-50',
                )}
              >
                {mood.mood_name}
                {/* WCAG 1.4.1: a pending mood must not be distinguished by
                    colour alone. The word carries the state, and a partner
                    seeing it needs to know their venue is not broken — it is
                    attached, it is simply not searchable yet. */}
                {mood.pending && <span className="font-semibold opacity-75">· pending</span>}
              </button>
            )
          })}
        </div>
        {errors.moods && (
          <p role="alert" className="mt-2 px-1 text-xs font-medium text-red-700">
            {errors.moods}
          </p>
        )}

        <SuggestMood chosen={chosen} onAdd={(resolved) => onMoodsChange({ ...moods, moods: [...chosen, resolved] })} />

        {/* ⚠️ "Typical spend" is in the design and is NOT here. The backend has
            said the field is on `Venue` but has never said what it is called —
            `averageSpend.js` resolves the name by reading it off a venue the
            bench has already sent, and in this flow there is no venue yet. An
            input that silently cannot save is the failure this codebase keeps
            paying for, and a number that looks saved and is not will be quoted
            to a customer. One confirmed fieldname and it comes back. */}
        <div className="mt-5 max-w-xs">
          <Select
            shape="field"
            ref={dressRef}
            label="Dress code"
            aria-label="Dress code"
            disabled={lookupsLoading}
            value={value.dress_code}
            onChange={set('dress_code')}
            {...defaultedProps('dress_code')}
          >
            <option value="">Select a dress code — optional</option>
            {(lookups?.dress_codes ?? []).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          {chipFor('dress_code', 'dress code', dressRef)}
        </div>
      </Section>

      {/* ------------------------------------------------------------- hours */}
      <Section
        id="hours"
        title="When you are open"
        subtitle={
          hoursFromImport ? 'Change these only if they are wrong.' : 'Pick the days and one pair of times.'
        }
      >
        {hoursFromImport ? (
          <div className="mt-3.5 flex flex-wrap items-start gap-3 rounded-2xl bg-brand-50 px-4 py-3 ring-1 ring-brand-600/30 ring-inset">
            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 fill-none stroke-brand-ink stroke-[1.75]"
            >
              <circle cx="10" cy="10" r="7.5" />
              <path d="M10 5.5V10l3 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="min-w-40 flex-1">
              <p className="text-[13.5px] font-bold text-ink-900">{hoursFromImport}</p>
              <p className="mt-1 text-xs text-ink-700">{importLabel}.</p>
            </div>
            <button
              type="button"
              onClick={onEditHours}
              className="p-1 text-[13px] font-bold text-brand-ink underline"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <p className="mb-2.5 text-[13px] font-semibold text-ink-700">Days open</p>
            <div
              data-field="days"
              tabIndex={-1}
              className={clsx(
                'flex flex-wrap gap-2 rounded-2xl',
                errors.days && 'p-3 ring-2 ring-red-700',
              )}
            >
              {DAYS.map((day) => (
                <DayChip
                  key={day.key}
                  label={day.label}
                  selected={hours.days.includes(day.key)}
                  onClick={() => toggleDay(day.key)}
                />
              ))}
            </div>
            {errors.days && (
              <p role="alert" className="mt-2 px-1 text-xs font-medium text-red-700">
                {errors.days}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-start gap-3.5">
              <Input
                shape="field"
                type="time"
                label="Opens"
                aria-label="Opens"
                className="w-36"
                value={hours.weekday.start}
                onChange={(e) => setTimes({ start: e.target.value })}
              />
              <Input
                shape="field"
                type="time"
                label="Closes"
                aria-label="Closes"
                className="w-36"
                value={hours.weekday.end}
                onChange={(e) => setTimes({ end: e.target.value })}
                error={errors.weekday}
                data-field="weekday"
              />
              <p className="pt-9 text-xs text-ink-500">Applied to every day picked.</p>
            </div>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------------- words */}
      {/* ⚠️ NOT OPTIONAL, though the design marked it so. `submit_venue_for_review`
          refuses a venue with an empty description — see `validateWords`. One
          answer satisfies it, which is why it is three short questions rather
          than the blank box this replaced. */}
      <Section
        id="words"
        title="In your own words"
        subtitle="Answer any one of these and we write the paragraph."
      >
        <div
          data-field="words"
          tabIndex={-1}
          className={clsx('mt-4 flex flex-col gap-3 rounded-2xl', errors.words && 'p-3 ring-2 ring-red-700')}
        >
          {PROMPTS.map((prompt) => (
            <div key={prompt.key} className="rounded-2xl border-2 border-ink-200 px-4 py-3.5">
              <label htmlFor={prompt.id} className="block text-[13.5px] font-bold text-ink-900">
                {prompt.question}
              </label>
              <input
                id={prompt.id}
                type="text"
                value={answers[prompt.key] || ''}
                placeholder={prompt.placeholder}
                onChange={(e) =>
                  onAnswersChange({ ...answers, [prompt.key]: e.target.value })
                }
                className="mt-2 block w-full border-0 border-b-2 border-ink-200 bg-transparent px-0.5 py-1.5 text-sm text-ink-900 focus:border-brand-edge focus:outline-none"
              />
            </div>
          ))}
        </div>
        {errors.words && (
          <p role="alert" className="mt-2 px-1 text-xs font-medium text-red-700">
            {errors.words}
          </p>
        )}

        {/* Read it back before they save. We assembled these sentences out of
            four-word answers, so the partner has to be able to see what we made
            of them — this is what they are publishing. */}
        {summary && (
          <div className="mt-4 rounded-2xl bg-ink-50 px-4.5 py-4 motion-safe:animate-[chip-in_250ms_ease-out]">
            <p className="text-xs font-bold tracking-wider text-ink-500 uppercase">
              What customers will read
            </p>
            <p className="mt-2 text-[14.5px] leading-relaxed text-pretty text-ink-900">{summary}</p>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------------ photos */}
      <Section id="photos" title={null}>
        <div className="flex items-start gap-3.5 rounded-2xl bg-ink-50 px-5 py-4">
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="mt-0.5 size-6 shrink-0 fill-none stroke-brand-ink stroke-[1.5]"
          >
            <rect x="2.5" y="5.5" width="15" height="11" rx="2.5" />
            <circle cx="10" cy="11" r="3" />
            <path d="M7 5.5 8 3.5h4l1 2" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-ink-900">Photos come next</h2>
            <p className="mt-1.5 text-[13.5px] text-ink-700">
              Better done standing in the room. Save this and the next screen is photos only.
            </p>
          </div>
        </div>
      </Section>

      {errors.photos && (
        <Alert variant="warning" className="mt-4">
          {errors.photos}
        </Alert>
      )}
    </div>
  )
}

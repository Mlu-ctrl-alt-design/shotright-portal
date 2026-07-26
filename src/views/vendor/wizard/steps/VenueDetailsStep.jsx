import { lazy, Suspense } from 'react'
import { useVenueLookups } from '../../../../hooks/useVendor'
import { Input, Select } from '../../../../components/ui'
import Spinner from '../../../../components/ui/Spinner'

/**
 * TipTap pulls in ProseMirror, which roughly doubles the bundle. Loading it
 * lazily keeps that weight off the login and dashboard screens — it only
 * arrives when a partner actually reaches this step. That matters for an
 * audience likely to be on mobile data.
 */
const RichTextEditor = lazy(() => import('../../../../components/ui/RichTextEditor'))

/**
 * Wizard step 2 — venue details.
 *
 * Field order and grouping follow `venue details filled.png`: the venue name on
 * its own, then manager name / surname, then cellphone / address, then the two
 * dropdowns, then the long-form description.
 *
 * Note the two selects are *different* fields — dress code and atmosphere. The
 * review screen in the designs labels both of them "Dress code", which is a
 * design bug rather than a spec (see the PRD appendix); the second value there,
 * "Out door laid back", is plainly an atmosphere.
 *
 * Inputs carry no visible labels, matching the designs — the placeholder is the
 * prompt. Each one keeps an aria-label so the form is still navigable by screen
 * reader, where a placeholder alone would not be announced reliably.
 */
function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 fill-none stroke-current stroke-[1.75]">
      <path d="M10 18s6-5.2 6-9.4A6 6 0 004 8.6C4 12.8 10 18 10 18z" strokeLinejoin="round" />
      <circle cx="10" cy="8.5" r="2.25" />
    </svg>
  )
}

export default function VenueDetailsStep({ value, onChange }) {
  const { data: lookups, isLoading } = useVenueLookups()
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })

  return (
    <div className="space-y-6">
      <div className="sm:w-1/2 sm:pr-3">
        <Input
          aria-label="Venue name"
          placeholder="Please type in your venue name"
          required
          value={value.venue_name}
          onChange={set('venue_name')}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Input
          aria-label="Manager name"
          placeholder="Please type in manager name"
          value={value.manager_name}
          onChange={set('manager_name')}
        />
        <Input
          aria-label="Manager surname"
          placeholder="Please type in manager surname"
          value={value.manager_surname}
          onChange={set('manager_surname')}
        />

        <Input
          type="tel"
          inputMode="tel"
          aria-label="Contact number"
          placeholder="Please type in contact number"
          value={value.contact_number}
          onChange={set('contact_number')}
        />
        <Input
          aria-label="Address"
          placeholder="Please type in your venue address"
          value={value.address}
          onChange={set('address')}
          trailing={<PinIcon />}
        />

        <Select
          aria-label="Dress code"
          value={value.dress_code}
          onChange={set('dress_code')}
          disabled={isLoading}
        >
          <option value="">Select a dress code</option>
          {(lookups?.dress_codes ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Atmosphere"
          value={value.atmosphere}
          onChange={set('atmosphere')}
          disabled={isLoading}
        >
          <option value="">Select an atmosphere</option>
          {(lookups?.atmospheres ?? []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </div>

      <Suspense
        fallback={
          <div className="grid min-h-56 place-items-center rounded-3xl border-2 border-brand-500">
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

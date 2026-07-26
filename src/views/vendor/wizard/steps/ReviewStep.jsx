import { useState } from 'react'
import { MoodPill } from '../../../../components/ui'
import { OperatingHoursSummary } from '../../../../components/ui/OperatingHours'
import { expandOperatingHours } from '../../../../services/vendor'
import { clsx } from '../../../../utils/clsx'

/**
 * Wizard step 5 — the read-only review before submitting.
 *
 * Matches `venue summary screen.png`: mood pills, a tinted panel of venue
 * details with the three operating-hour ranges, then one collapsible row per
 * menu category.
 *
 * The design labels two different fields "Dress code" — the second value,
 * "Out door laid back", is plainly the atmosphere. Labelled correctly here; see
 * the PRD appendix.
 */
const formatPrice = (value) =>
  `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Field({ label, value }) {
  return (
    <div>
      <p className="text-lg leading-snug font-semibold text-ink-900">{value || '—'}</p>
      <p className="mt-0.5 text-sm text-ink-700">{label}</p>
    </div>
  )
}

function Chevron({ open }) {
  return (
    <svg
      viewBox="0 0 14 8"
      className={clsx('h-2 w-3.5 fill-none stroke-current stroke-2 transition', open && 'rotate-180')}
    >
      <path d="M1 1l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ReviewStep({ moods, details, hours, menu }) {
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState({})

  const range = (r) => (r?.start && r?.end ? `${r.start} - ${r.end}` : '—')
  const hasSummary = Boolean(details.summary && details.summary.replace(/<[^>]*>/g, '').trim())

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-ink-700">Added moods, vibes to your restaurant</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {moods.moods.length === 0 && <p className="text-sm text-ink-500">No moods added.</p>}
          {moods.moods.map((m) => (
            <MoodPill key={m.mood} variant={m.status}>
              {m.label}
            </MoodPill>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-tint p-6">
        <h2 className="text-2xl font-bold text-ink-900">
          Venue summary details{details.venue_name ? ` - ${details.venue_name}` : ''}
        </h2>

        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <Field label="Manager name" value={details.manager_name} />
          <Field label="Manager surname" value={details.manager_surname} />
          <Field label="Contact number" value={details.contact_number} />
          <Field label="Address" value={details.address} />
          <Field label="Dress code" value={details.dress_code} />
          <Field label="Atmosphere" value={details.atmosphere} />
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-bold text-ink-900">Summary</h3>
          {hasSummary ? (
            <>
              {/* The partner's own copy, rendered back to them in their own
                  browser. It still must be sanitised server-side before the
                  customer app shows it to anyone else. */}
              <div
                className={clsx(
                  'prose-editor mt-1 text-sm text-ink-900',
                  !showAll && 'line-clamp-4',
                )}
                dangerouslySetInnerHTML={{ __html: details.summary }}
              />
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-1 ml-auto block text-sm text-brand-ink underline"
              >
                {showAll ? 'Show less' : 'View all'}
              </button>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-500">No description added.</p>
          )}
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Field label="Weekday" value={range(hours.weekday)} />
          <Field label="Weekend" value={range(hours.weekend)} />
          <Field label="Public Holidays" value={range(hours.publicHoliday)} />
        </div>

        {/* The three ranges above are how the hours were ENTERED. This is what
            actually gets SAVED, day by day, after expandOperatingHours() maps
            them onto the backend's per-day rows — including which side of the
            weekend boundary each day landed on. A review screen that only
            echoes its own input cannot catch a wrong weekend setting. This one
            can, and it is the last chance to. */}
        <div className="mt-5 border-t border-brand-200 pt-4">
          <p className="text-xs font-bold tracking-wide text-ink-500 uppercase">How this saves</p>
          <OperatingHoursSummary rows={expandOperatingHours(hours).rows} className="mt-1.5" />
          {hours.publicHoliday?.start && (
            <p className="mt-2 text-xs text-ink-500">
              Public holiday hours aren&rsquo;t stored by the app yet, so they don&rsquo;t appear
              here.
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        {menu.categories.length === 0 && (
          <p className="text-sm text-ink-500">No menu categories added.</p>
        )}
        {menu.categories.map((category) => {
          const isOpen = Boolean(open[category.id])
          return (
            <div key={category.id} className="overflow-hidden rounded-lg bg-ink-50">
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [category.id]: !isOpen }))}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left"
              >
                <span className="text-lg font-bold tracking-tight text-ink-900 uppercase">
                  {category.name} - Menu
                </span>
                <span className="flex items-center gap-2 text-sm font-medium text-brand-ink">
                  {isOpen ? 'Collapse' : 'Expand'}
                  <Chevron open={isOpen} />
                </span>
              </button>

              {isOpen && (
                <div className="bg-white px-5 py-3">
                  {category.items.length === 0 ? (
                    <p className="py-2 text-sm text-ink-500">Nothing in this category.</p>
                  ) : (
                    <ul className="divide-y divide-ink-200">
                      {category.items.map((item) => (
                        <li key={item.id} className="flex items-center gap-4 py-2.5">
                          {item.image ? (
                            <img src={item.image} alt="" className="size-9 rounded-full object-cover" />
                          ) : (
                            <span className="size-9 shrink-0 rounded-full bg-ink-50" />
                          )}
                          <span className="min-w-0 flex-1 text-sm font-medium text-ink-900 uppercase">
                            {item.name}
                          </span>
                          <span className="text-sm whitespace-nowrap text-ink-900">
                            {formatPrice(item.price)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

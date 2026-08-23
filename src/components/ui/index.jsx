/**
 * Sho't Right Partner Portal — UI primitives.
 *
 * These mirror the Untitled UI React component surface (Button, Input, Select,
 * Badge, Card, EmptyState, Alert) so each can be swapped for its Untitled UI
 * counterpart without touching a view — but the *styling* is driven by the
 * approved partner-portal designs, not by Untitled UI defaults.
 *
 * Shape rules taken from the designs (docs/PRD-shot-right-partner-portal.md
 * §7.1.1): inputs and buttons are fully rounded pills with a yellow border,
 * placeholders are italic, primary actions are solid yellow with an uppercase
 * label, secondary actions are white with a yellow border, and CANCEL is bare
 * yellow text with no box.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { clsx } from '../../utils/clsx'

/* ---------------------------------------------------------------- Button */
// UNTITLED UI: https://www.untitledui.com/react/components/buttons
export function Button({
  variant = 'primary',
  size = 'md',
  // Wizard and dashboard actions are uppercase pills; the login button is a
  // sentence-case rounded rectangle. Both shapes come from the designs.
  caps = true,
  shape = 'pill',
  // `as="a"` for actions that are genuinely navigations — a mailto, a download.
  // Those must be real anchors: right-clickable, showing their destination on
  // hover, and openable in a new tab. Wrapping a <button> in an <a> is invalid
  // HTML and loses all three.
  as: Component = 'button',
  className,
  disabled,
  loading,
  children,
  ...props
}) {
  const variants = {
    // Solid yellow pill — NEXT, SUBMIT, ADD, Login.
    primary: 'bg-brand-500 text-ink-900 shadow-sm hover:bg-brand-600',
    // White pill with a yellow border — PREVIOUS.
    secondary: 'bg-white text-brand-ink ring-2 ring-inset ring-field hover:bg-brand-50',
    // Bare yellow text — CANCEL, View all, Expand.
    ghost: 'text-brand-ink hover:text-brand-900',
    danger: 'bg-red-700 text-white shadow-sm hover:bg-red-800',
  }
  const sizes = {
    sm: 'px-4 py-1.5 text-xs',
    md: 'px-6 py-2.5 text-sm',
    lg: 'px-8 py-3 text-sm',
  }

  return (
    <Component
      // An anchor has no `disabled`; `aria-disabled` is what carries the state
      // there, and the caller drops `href` to actually stop it navigating.
      {...(Component === 'button'
        ? { disabled: disabled || loading }
        : { 'aria-disabled': disabled || loading || undefined })}
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-semibold transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        shape === 'pill' ? 'rounded-full' : 'rounded-2xl',
        caps && 'tracking-wide uppercase',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </Component>
  )
}

/* ----------------------------------------------------------------- Input */
// UNTITLED UI: https://www.untitledui.com/react/components/inputs
/**
 * `prefilled` marks a field holding an unmodified smart default (spec §7):
 * warm background, brand-edge border. Both clear the instant it goes dirty,
 * with a 250ms colour fade so the change is noticed rather than blinked past.
 */
/* `data-prefilled` mirrors the visual marker as an attribute. The colour says
   "we filled this in" to people who can see it; the attribute says it to
   anything else that needs to know, tests included. */
export function Input({
  label,
  error,
  hint,
  className,
  id,
  trailing,
  prefilled,
  // Keep a line's worth of space under the field whether or not there is a
  // message. See the note on `messageRow` below — this is not cosmetic.
  reserveMessage,
  ...props
}) {
  // Generated rather than derived from `name`: the same form renders once per
  // menu heading, so a name-based id would collide across instances and point
  // every label at the first input on the page.
  const generatedId = useId()
  const inputId = id || generatedId
  const msgId = `${inputId}-msg`

  // The error used to render as a bare sibling <p>: visible, and completely
  // silent to a screen reader, which is the population least able to spot a red
  // line they were not told about. `aria-invalid` marks the state and
  // `aria-describedby` reads the reason.
  //
  // The caller's own describedby is PRESERVED, not replaced — a smart-defaulted
  // field points at its chip, and both need announcing.
  const describedBy =
    [props['aria-describedby'], error || hint ? msgId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-ink-900">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          {...props}
          data-prefilled={prefilled ? 'true' : undefined}
          aria-describedby={describedBy}
          className={clsx(
            'block w-full rounded-full border-2 px-5 py-2.5 text-sm text-ink-900',
            'placeholder:text-ink-500 focus:border-brand-edge focus:outline-none',
            'transition-colors duration-250',
            trailing && 'pr-11',
            error
              ? 'border-red-700 bg-white'
              : prefilled
                ? 'border-brand-edge bg-prefill'
                : 'border-field bg-white',
          )}
        />
        {trailing && (
          <span className="pointer-events-none absolute inset-y-0 right-4 grid place-items-center text-ink-500">
            {trailing}
          </span>
        )}
      </div>
      {/* RESERVED MESSAGE ROW — this fixes a real, reproducible bug.
          Validation errors appear on blur. Blur happens on MOUSEDOWN. So
          clicking a button below the form used to insert an error message
          between mousedown and mouseup, shifting the button out from under the
          pointer — and a click event needs both on the same element. The button
          simply did not fire, and the partner had to click Next twice with
          nothing on screen explaining why.
          Reserving the space means revealing a message reflows nothing.
          Messages on reserved fields must stay to ONE LINE at the narrowest
          column they render in, or the shift comes back. */}
      {/* The 6px gap lives on the CONTAINER, not on the message, so the
          reserved height is exact arithmetic rather than a guess that has to
          account for margin collapsing: 6px padding + 16px line = 22px, whether
          or not a message is present. Measured at zero shift. */}
      <div className={clsx('pt-1.5', reserveMessage && 'min-h-[1.375rem]')}>
        {error && (
          <p id={msgId} className="px-2 text-xs font-medium text-red-700">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={msgId} className="px-2 text-xs text-ink-500">
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------- PasswordInput */
/**
 * A password field with a show/hide control.
 *
 * Separate from `Input` rather than a `trailing` slot because that slot is
 * `pointer-events-none` — it exists to hang decorative icons off, and a control
 * you cannot click is not a control.
 *
 * ACCESSIBILITY, and the reason this is a `<button>` and not a styled `<span>`:
 *
 *  - `type="button"` — inside a form, a bare button submits it. Revealing your
 *    password must not post the form.
 *  - `aria-pressed` carries the state, so a screen reader announces "show
 *    password, pressed" rather than leaving the toggle silent. The visible
 *    label changes with it for everyone else.
 *  - `aria-controls` ties the button to the field it governs.
 *  - The eye glyph is `aria-hidden`; the accessible name comes from the label,
 *    because an icon alone gives a screen reader nothing to read.
 *  - It sits in the tab order between this field and the next, which is where
 *    someone would reach for it.
 *
 * The revealed value is `type="text"`, which means autofill and password
 * managers see a text input while shown. That is the standard trade and is what
 * makes the toggle work at all; the field is `autoComplete="new-password"` on
 * the register form, so nothing is being re-typed into it anyway.
 */
export function PasswordInput({ label, error, hint, className, id, ...props }) {
  const generatedId = useId()
  const inputId = id || generatedId
  const [shown, setShown] = useState(false)

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-ink-900">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type={shown ? 'text' : 'password'}
          className={clsx(
            'block w-full rounded-full border-2 bg-white py-2.5 pr-24 pl-5 text-sm text-ink-900',
            'placeholder:text-ink-500 focus:border-brand-edge focus:outline-none',
            error ? 'border-red-700' : 'border-field',
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-pressed={shown}
          aria-controls={inputId}
          className={clsx(
            'absolute inset-y-1 right-1.5 inline-flex items-center gap-1.5 rounded-full px-3',
            'text-xs font-semibold text-ink-700 hover:bg-brand-50 hover:text-ink-900',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
          )}
        >
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="size-4 shrink-0 fill-none stroke-current stroke-[1.5]"
          >
            <path d="M1.5 10S4.9 4.5 10 4.5 18.5 10 18.5 10 15.1 15.5 10 15.5 1.5 10 1.5 10Z" />
            <circle cx="10" cy="10" r="2.5" />
            {shown && <path d="M3.5 16.5 16.5 3.5" strokeLinecap="round" />}
          </svg>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {error && <p className="mt-1.5 px-2 text-xs text-red-700">{error}</p>}
      {hint && !error && <p className="mt-1.5 px-2 text-xs text-ink-500">{hint}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- Select */
// UNTITLED UI: https://www.untitledui.com/react/components/select
export function Select({ label, error, className, id, children, prefilled, reserveMessage, ...props }) {
  const generatedId = useId()
  const inputId = id || generatedId
  const msgId = `${inputId}-msg`
  const describedBy =
    [props['aria-describedby'], error ? msgId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-ink-900">
          {label}
        </label>
      )}
      {/* appearance-none strips the native arrow, so the chevron the designs
          show has to be drawn back in. */}
      <div className="relative">
        <select
          id={inputId}
          aria-invalid={error ? true : undefined}
          {...props}
          aria-describedby={describedBy}
          className={clsx(
            'block w-full appearance-none rounded-full border-2 py-2.5 pr-11 pl-5 text-sm text-ink-900',
            'focus:border-brand-edge focus:outline-none',
            'transition-colors duration-250',
            'disabled:cursor-not-allowed disabled:opacity-60',
            error
              ? 'border-red-700 bg-white'
              : prefilled
                ? 'border-brand-edge bg-prefill'
                : 'border-field bg-white',
          )}
        >
          {children}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-4 grid place-items-center text-ink-500">
          <svg viewBox="0 0 14 8" className="h-2 w-3.5 fill-none stroke-current stroke-2">
            <path d="M1 1l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      {/* Same reserved row as Input — see the note there. */}
      <div className={clsx('pt-1.5', reserveMessage && 'min-h-[1.375rem]')}>
        {error && (
          <p id={msgId} className="px-2 text-xs font-medium text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Textarea */
export function Textarea({ label, error, className, id, ...props }) {
  const generatedId = useId()
  const inputId = id || generatedId
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-ink-900">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        rows={3}
        className={clsx(
          'block w-full rounded-3xl border-2 bg-white px-5 py-3 text-sm text-ink-900',
          'placeholder:text-ink-500 focus:border-brand-edge focus:outline-none',
          error ? 'border-red-700' : 'border-field',
        )}
        {...props}
      />
      {error && <p className="mt-1.5 px-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}

/* --------------------------------------------------------------- MoodPill */
/**
 * A mood on a venue, e.g. "Boys Night Out". Removable when `onRemove` is given.
 * `className` carries the outlined treatment used for moods still awaiting a
 * Desk decision (see MoodStep).
 */
export function MoodPill({ children, onRemove, variant = 'canonical', className }) {
  // Variants swap the whole colour set rather than layering an override: two
  // competing text-* utilities resolve by stylesheet order, not call order, so
  // an override class silently loses (white text on a white pill).
  const variants = {
    canonical: 'bg-deep-500 text-ink-900',
    suggested: 'bg-white text-brand-ink ring-2 ring-inset ring-field',
  }
  const pending = variant === 'suggested'
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        variants[variant],
        className,
      )}
    >
      {children}
      {/* WCAG 1.4.1: a pending mood must not be distinguished by colour and
          outline alone. The word carries the state for anyone not seeing the
          styling — including a screen reader, which announces neither. */}
      {pending && (
        <span className="font-semibold opacity-80">
          <span aria-hidden="true">· </span>pending
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${children}`}
          className="grid size-3.5 place-items-center rounded-full opacity-80 transition hover:bg-black/10 hover:opacity-100"
        >
          <svg viewBox="0 0 10 10" className="size-2 fill-none stroke-current stroke-2">
            <path d="M1 1l8 8M9 1l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  )
}

/* ---------------------------------------------------------------- DayChip */
/** SUN–SAT selector on the operating-hours step: a rounded square, solid when on. */
export function DayChip({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'w-[4.5rem] rounded-2xl px-2 py-4 text-xs font-bold tracking-wide transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        selected
          ? 'bg-brand-500 text-ink-900 shadow-sm'
          : 'bg-white text-ink-700 ring-2 ring-inset ring-field hover:ring-brand-ink',
      )}
    >
      {label}
    </button>
  )
}

/* ----------------------------------------------------------------- Toggle */
/** The "Weekend starts FRIDAY" switch. Renders its ON/OFF state inside the knob. */
export function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-3">
      {label && <span className="text-sm font-bold text-brand-600">{label}</span>}
      <span className="relative inline-flex">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={clsx(
            'flex h-6 w-14 items-center rounded-full px-1 transition',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600',
            checked ? 'justify-end bg-brand-500' : 'justify-start bg-brand-200',
          )}
        >
          <span className="grid size-4 place-items-center rounded-full bg-white text-[7px] font-bold text-ink-500">
            {checked ? 'ON' : 'OFF'}
          </span>
        </span>
      </span>
    </label>
  )
}

/* -------------------------------------------------------- UploadProgress */
/** Green upload bar: `"menu.xlsx" is being uploaded - 50%`. */
export function UploadProgress({ fileName, percent }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent ?? 0)))
  return (
    <div
      className="h-5 w-full overflow-hidden rounded-full bg-ink-200"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="flex h-full items-center rounded-full bg-green-700 px-3 whitespace-nowrap transition-[width] duration-300"
        style={{ width: `${Math.max(pct, 22)}%` }}
      >
        <span className="text-[10px] font-bold text-white">
          &ldquo;{fileName}&rdquo; is being uploaded - {pct}%
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Toast */
/** Green confirmation, prefixed "Chisa!" as in the designs. */
export function Toast({ title = 'Chisa!', message, onDismiss }) {
  if (!message) return null
  return (
    <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-2xl bg-green-50 px-4 py-3 ring-1 ring-green-600/20">
      <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 fill-green-600">
        <path d="M10 0a10 10 0 100 20 10 10 0 000-20zm4.7 7.7l-5.4 5.4a1 1 0 01-1.4 0L5.3 10.5a1 1 0 111.4-1.4l1.9 1.9 4.7-4.7a1 1 0 111.4 1.4z" />
      </svg>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold text-green-800">{title}</p>
        <p className="text-green-800">{message}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-green-700 hover:text-green-900"
        >
          <svg viewBox="0 0 10 10" className="size-2.5 fill-none stroke-current stroke-2">
            <path d="M1 1l8 8M9 1l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- Badge */
// UNTITLED UI: https://www.untitledui.com/react/components/badges
const BADGE_TONES = {
  Approved: 'bg-green-50 text-green-700 ring-green-600/20',
  Pending: 'bg-brand-50 text-brand-800 ring-brand-600/30',
  Rejected: 'bg-red-50 text-red-700 ring-red-600/20',
  Declined: 'bg-red-50 text-red-700 ring-red-600/20',
  Draft: 'bg-gray-100 text-ink-700 ring-gray-500/20',
}

export function Badge({ children, tone }) {
  const cls = BADGE_TONES[tone ?? children] || BADGE_TONES.Draft
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        cls,
      )}
    >
      {children}
    </span>
  )
}

/* ---------------------------------------------------------- OverflowMenu */
/**
 * A "⋯" button that discloses the secondary actions for a row.
 *
 * DELIBERATELY NOT the ARIA menu pattern. `role="menu"` promises arrow-key
 * traversal, typeahead, and focus wrapping — none of which is implemented
 * here, and a promise a screen reader user finds broken is worse than the
 * humbler truth: this is a disclosure (aria-expanded on the button) revealing
 * a list of ordinary links. Same reasoning as the venue tabs: semantics follow
 * the behaviour, not the appearance.
 *
 * The panel is `position: fixed`, anchored to the button when it opens,
 * because these rows live inside an `overflow-x-auto` table wrapper — an
 * absolutely-positioned panel would be clipped by it, and the last row's menu
 * would open into nothing. Fixed positioning ignores the clip; the trade-off
 * is that the anchor goes stale when the page scrolls, so any scroll simply
 * closes the panel rather than letting it float away from its button.
 */
export function OverflowMenu({ label, children, className }) {
  const [anchor, setAnchor] = useState(null) // null = closed; else {top,right}
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const open = anchor !== null

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setAnchor(null)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setAnchor(null)
        buttonRef.current?.focus()
      }
    }
    const onScroll = () => setAnchor(null)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // Capture phase: the scroll that matters may happen on the table wrapper,
    // and scroll events do not bubble.
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const toggle = () => {
    if (open) {
      setAnchor(null)
      return
    }
    const rect = buttonRef.current.getBoundingClientRect()
    setAnchor({
      top: rect.bottom + 4,
      right: Math.max(window.innerWidth - rect.right, 8),
    })
  }

  return (
    <div ref={rootRef} className={clsx('relative inline-flex', className)}>
      <button
        type="button"
        ref={buttonRef}
        aria-label={label}
        aria-expanded={open}
        onClick={toggle}
        className={clsx(
          'flex h-8 w-8 items-center justify-center rounded-full text-ink-700 transition',
          'hover:bg-brand-50 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-500',
          open && 'bg-brand-50 text-ink-900',
        )}
      >
        {/* Three dots, drawn rather than typed: the ellipsis glyph sits on the
            baseline and reads as punctuation to a copy-paster. */}
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <circle cx="4" cy="10" r="1.7" />
          <circle cx="10" cy="10" r="1.7" />
          <circle cx="16" cy="10" r="1.7" />
        </svg>
      </button>
      {open && (
        <div
          style={{ position: 'fixed', top: anchor.top, right: anchor.right }}
          className="z-30 w-48 rounded-xl bg-white py-1.5 shadow-lg ring-1 ring-gray-200"
          // Any click that lands on a link or button inside has done its job;
          // the panel closing is part of the action completing.
          onClick={(e) => {
            if (e.target.closest('a, button')) setAnchor(null)
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * One row of an OverflowMenu — spacing and hover treatment only. `as` takes a
 * router Link (the kit stays router-free, same trick as MetricCard).
 */
export function OverflowMenuItem({ as: Component = 'a', className, children, ...props }) {
  return (
    <Component
      className={clsx(
        'block px-4 py-2 text-sm font-medium text-ink-700 transition',
        'hover:bg-brand-50 hover:text-ink-900',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}

/* ------------------------------------------------------------------ Card */
export function Card({ title, action, children, className }) {
  return (
    <section className={clsx('rounded-3xl bg-white ring-1 ring-brand-200', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-brand-100 px-6 py-4">
          {title && <h2 className="text-sm font-bold text-ink-900">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-6">{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------ MetricCard */
// UNTITLED UI: https://www.untitledui.com/react/components/metrics
/**
 * `as` lets the caller pass a router Link so the tile becomes the way through
 * to the list it counts. A count you cannot act on is a dead end, and "3
 * pending" is a question ("which three?") that the tile should answer.
 *
 * The whole tile is the target rather than the number, so it clears the 44px
 * touch minimum without any extra work.
 */
export function MetricCard({ label, value, tone = 'default', as: Component = 'div', ...props }) {
  const tones = {
    default: 'text-ink-900',
    positive: 'text-green-700',
    warning: 'text-brand-700',
    negative: 'text-red-700',
  }
  const interactive = Component !== 'div'
  return (
    <Component
      className={clsx(
        'block rounded-3xl bg-white p-5 ring-1 ring-brand-200',
        interactive && 'transition hover:ring-2 hover:ring-brand-edge',
      )}
      {...props}
    >
      <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{label}</p>
      <p className={clsx('mt-2 text-3xl font-bold', tones[tone])}>{value}</p>
    </Component>
  )
}

/* ------------------------------------------------------------ EmptyState */
// UNTITLED UI: https://www.untitledui.com/react/components/empty-state
export function EmptyState({ title, description, action }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-brand-300 p-10 text-center">
      <h3 className="text-sm font-bold text-ink-900">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/* ----------------------------------------------------------------- Alert */
// UNTITLED UI: https://www.untitledui.com/react/components/alerts
export function Alert({ variant = 'info', className, children }) {
  const variants = {
    info: 'bg-blue-50 text-blue-800 ring-blue-600/20',
    success: 'bg-green-50 text-green-800 ring-green-600/20',
    warning: 'bg-brand-50 text-brand-900 ring-brand-600/30',
    danger: 'bg-red-50 text-red-800 ring-red-600/20',
  }
  if (!children) return null
  return (
    <div
      role="alert"
      className={clsx(
        'rounded-2xl px-4 py-3 text-sm ring-1 ring-inset',
        variants[variant],
        className,
      )}
    >
      {children}
    </div>
  )
}

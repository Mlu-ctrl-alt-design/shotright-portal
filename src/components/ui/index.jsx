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
import { useId } from 'react'
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
  className,
  disabled,
  loading,
  children,
  ...props
}) {
  const variants = {
    // Solid yellow pill — NEXT, SUBMIT, ADD, Login.
    primary:
      'bg-brand-500 text-white shadow-sm hover:bg-brand-600 focus-visible:outline-brand-600',
    // White pill with a yellow border — PREVIOUS.
    secondary:
      'bg-white text-brand-700 ring-2 ring-inset ring-brand-500 hover:bg-brand-50 focus-visible:outline-brand-600',
    // Bare yellow text — CANCEL, View all, Expand.
    ghost: 'text-brand-600 hover:text-brand-700 focus-visible:outline-brand-600',
    danger: 'bg-red-500 text-white shadow-sm hover:bg-red-600 focus-visible:outline-red-600',
  }
  const sizes = {
    sm: 'px-4 py-1.5 text-xs',
    md: 'px-6 py-2.5 text-sm',
    lg: 'px-8 py-3 text-sm',
  }

  return (
    <button
      disabled={disabled || loading}
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
    </button>
  )
}

/* ----------------------------------------------------------------- Input */
// UNTITLED UI: https://www.untitledui.com/react/components/inputs
export function Input({ label, error, hint, className, id, trailing, ...props }) {
  // Generated rather than derived from `name`: the same form renders once per
  // menu heading, so a name-based id would collide across instances and point
  // every label at the first input on the page.
  const generatedId = useId()
  const inputId = id || generatedId
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
          className={clsx(
            'block w-full rounded-full border-2 bg-white px-5 py-2.5 text-sm text-ink-900',
            'placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-300',
            trailing && 'pr-11',
            error ? 'border-red-500' : 'border-brand-500',
          )}
          {...props}
        />
        {trailing && (
          <span className="pointer-events-none absolute inset-y-0 right-4 grid place-items-center text-brand-500">
            {trailing}
          </span>
        )}
      </div>
      {error && <p className="mt-1.5 px-2 text-xs text-red-600">{error}</p>}
      {hint && !error && <p className="mt-1.5 px-2 text-xs text-ink-500">{hint}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- Select */
// UNTITLED UI: https://www.untitledui.com/react/components/select
export function Select({ label, error, className, id, children, ...props }) {
  const generatedId = useId()
  const inputId = id || generatedId
  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-ink-900">
          {label}
        </label>
      )}
      <select
        id={inputId}
        className={clsx(
          'block w-full appearance-none rounded-full border-2 bg-white px-5 py-2.5 text-sm text-ink-900',
          'focus:outline-none focus:ring-2 focus:ring-brand-300',
          error ? 'border-red-500' : 'border-brand-500',
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1.5 px-2 text-xs text-red-600">{error}</p>}
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
          'placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-brand-300',
          error ? 'border-red-500' : 'border-brand-500',
        )}
        {...props}
      />
      {error && <p className="mt-1.5 px-2 text-xs text-red-600">{error}</p>}
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
    canonical: 'bg-deep-500 text-white',
    suggested: 'bg-white text-brand-700 ring-2 ring-inset ring-brand-500',
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        variants[variant],
        className,
      )}
    >
      {children}
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
          ? 'bg-brand-500 text-white shadow-sm'
          : 'bg-white text-ink-500 ring-2 ring-inset ring-brand-200 hover:ring-brand-400',
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
        className="flex h-full items-center rounded-full bg-green-500 px-3 whitespace-nowrap transition-[width] duration-300"
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
    <div className="flex items-start gap-3 rounded-2xl bg-green-50 px-4 py-3 ring-1 ring-green-600/20">
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
export function MetricCard({ label, value, tone = 'default' }) {
  const tones = {
    default: 'text-ink-900',
    positive: 'text-green-700',
    warning: 'text-brand-700',
    negative: 'text-red-700',
  }
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-brand-200">
      <p className="text-xs font-semibold tracking-wide uppercase text-ink-500">{label}</p>
      <p className={clsx('mt-2 text-3xl font-bold', tones[tone])}>{value}</p>
    </div>
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
export function Alert({ variant = 'info', children }) {
  const variants = {
    info: 'bg-blue-50 text-blue-800 ring-blue-600/20',
    success: 'bg-green-50 text-green-800 ring-green-600/20',
    warning: 'bg-brand-50 text-brand-900 ring-brand-600/30',
    danger: 'bg-red-50 text-red-800 ring-red-600/20',
  }
  if (!children) return null
  return (
    <div className={clsx('rounded-2xl px-4 py-3 text-sm ring-1 ring-inset', variants[variant])}>
      {children}
    </div>
  )
}

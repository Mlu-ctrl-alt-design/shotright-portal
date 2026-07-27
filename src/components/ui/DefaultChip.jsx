import { clsx } from '../../utils/clsx'

/**
 * The marker on a field holding a value we supplied (spec §7).
 *
 * It carries all three of the governing principles at once: it makes the
 * default VISIBLE, its ✕ makes it REVERSIBLE in one action, and for Tier B it
 * carries the confirm control that stops the default being silently
 * load-bearing.
 *
 * ACCESSIBILITY (§11):
 *  - The chip's text is associated with its field by `aria-describedby`, set by
 *    the caller, so a screen reader announces "Manager name, edit text, Mlu,
 *    From your profile" rather than a mysteriously populated field.
 *  - The ✕ has an explicit label — "Clear default manager name" — because a
 *    row of identically-labelled ✕ buttons is unusable out of context.
 *  - Source is conveyed by TEXT, not only by the colour of the chip. The three
 *    palettes are a shorthand for people who can see them, not the message.
 */
const TONES = {
  // Verified: 4.95:1, 5.51:1 and 4.85:1 respectively. Taken from the spec
  // unchanged — all three clear 4.5:1.
  profile: 'bg-[#fdf5df] text-[#8a6400]',
  popular: 'bg-[#eef4ff] text-[#2f5cc4]',
  location: 'bg-[#e9f7ef] text-[#1c7a45]',
}

export default function DefaultChip({
  id,
  tone = 'profile',
  children,
  onDismiss,
  dismissLabel,
  onConfirm,
  confirmLabel,
  needsConfirm = false,
}) {
  return (
    <span
      id={id}
      className={clsx(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        // Wraps rather than overflowing — §9 requires long values not to clip.
        'break-words',
        'motion-safe:animate-[chip-in_250ms_ease]',
        TONES[tone],
      )}
    >
      {children}

      {needsConfirm && onConfirm && (
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-full bg-white/70 px-2 py-0.5 font-bold underline decoration-current/40 hover:bg-white"
        >
          {confirmLabel || 'Confirm'}
        </button>
      )}

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="grid size-4 shrink-0 place-items-center rounded-full opacity-65 transition hover:opacity-100 focus-visible:opacity-100"
        >
          <svg viewBox="0 0 10 10" className="size-2 fill-none stroke-current stroke-2">
            <path d="M1 1l8 8M9 1l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  )
}

/**
 * Reserved space under every field, chip or no chip (§7).
 *
 * The minimum height is the point: clearing a default must not shift the fields
 * below it. A row that collapses to zero turns a dismissal into a page-wide
 * jump, which reads as the form breaking.
 */
export function ChipRow({ children }) {
  return <div className="mt-2 flex min-h-6 flex-wrap gap-2">{children}</div>
}

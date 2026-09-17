/**
 * The PRO chip. Brand yellow with dark ink — white on yellow measures 1.61:1
 * and is banned across this product (see the palette note in index.css).
 */
export default function ProBadge({ className }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full bg-brand-500 px-2.5 py-1 text-[11px] ' +
        'font-bold tracking-wider text-ink-900 ' +
        (className || '')
      }
    >
      PRO
    </span>
  )
}

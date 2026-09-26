import { useProStatus } from '../../hooks/usePlan'

/**
 * "PRO", beside the logo, on every page — for a partner on a live Pro plan.
 *
 * A trial says so ("PRO TRIAL"): calling a trial plain Pro would be the first
 * thing contradicted when it ends. Nothing renders for a partner who has not
 * bought Pro, including grandfathered ones who hold the features anyway.
 */
export default function ProBadge({ className = '' }) {
  const status = useProStatus()
  if (!status) return null
  const label = status === 'trial' ? 'PRO TRIAL' : 'PRO'
  return (
    <span
      title={status === 'trial' ? 'You’re on a Pro trial' : 'You’re on Pro'}
      className={`inline-flex items-center rounded-full bg-ink-900 px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider text-white ${className}`}
    >
      {label}
    </span>
  )
}

export default function Spinner({ label }) {
  return (
    <div className="flex flex-col items-center gap-3 text-ink-500">
      <span className="size-8 animate-spin rounded-full border-3 border-brand-200 border-t-brand-600" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}

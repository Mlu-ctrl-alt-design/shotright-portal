import { Card } from './index'

/**
 * The shape of a menu, while the menu is being fetched.
 *
 * ⚠️ This screen used to return `<Spinner label="Loading menu…" />` INSTEAD of
 * itself, so the venue header, the tabs and the layout all disappeared and then
 * snapped back. Two costs: the page jumps, and — worse — a slow menu and a
 * broken one look exactly the same to a partner watching a spinner.
 *
 * Bones, not a spinner, and in the real proportions: one rail, one section, a
 * few rows. Whatever arrives lands in the space already held for it.
 *
 * `aria-hidden` on the bones and one live region carrying the words: a screen
 * reader gets "Loading your menu" once, not a description of forty grey boxes.
 */
const Bone = ({ className }) => (
  <span className={`block animate-pulse rounded bg-ink-200 ${className}`} aria-hidden="true" />
)

const Row = ({ wide }) => (
  <li className="flex items-center justify-between gap-4 py-3.5">
    <span className="flex min-w-0 flex-1 flex-col gap-2">
      <Bone className={wide ? 'h-3 w-48' : 'h-3 w-32'} />
      <Bone className={wide ? 'h-2.5 w-72' : 'h-2.5 w-56'} />
    </span>
    <Bone className="h-3 w-14 shrink-0" />
  </li>
)

export default function MenuSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Menu</h1>
        <p className="mt-1 text-sm text-ink-500" role="status">
          Loading your menu…
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <Card title="Sections" className="hidden lg:block">
          <ul className="-my-1 space-y-3.5">
            {['w-20', 'w-16', 'w-24', 'w-14'].map((w) => (
              <li key={w} className="flex items-center justify-between gap-3">
                <Bone className={`h-3 ${w}`} />
                <Bone className="h-3 w-4" />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <Bone className="mb-1 h-3.5 w-28" />
          <ul className="divide-y divide-gray-200">
            <Row wide />
            <Row />
            <Row wide />
          </ul>
        </Card>
      </div>
    </div>
  )
}

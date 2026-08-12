import { Link, useLocation } from 'react-router-dom'
import { useLegalStanding } from '../../hooks/useLegalStanding'

/**
 * "There's something to accept."
 *
 * Deliberately NOT dismissible. A dismissible banner is a banner that gets
 * dismissed, and this one is the only warning a partner gets before a submit
 * stops working — a rule you only learn about at the moment it blocks you is
 * indistinguishable from a bug.
 *
 * It is also deliberately not a modal. The partner can still work: edit a
 * menu, fix hours, answer a decline. Nothing they can do today is unsafe
 * without an acceptance, and interrupting all of it to collect one would be us
 * putting our paperwork ahead of their Friday.
 *
 * Hidden on `/legal` itself — pointing at the page you are already on is noise,
 * and noise is how a banner stops being read.
 */
export default function LegalBanner() {
  const { pending, outstanding } = useLegalStanding()
  const { pathname } = useLocation()

  if (!pending || pathname === '/legal') return null

  const many = outstanding.length > 1

  return (
    <div role="status" className="mb-4 rounded-2xl bg-brand-50 px-4 py-3 text-sm ring-1 ring-inset ring-brand-600/30">
      <p className="font-bold text-brand-900">
        {many ? `${outstanding.length} documents need your agreement` : 'One document needs your agreement'}
      </p>
      <p className="mt-1 text-brand-900">
        You can carry on as normal — but a venue can’t go to our reviewers until{' '}
        {many ? 'they’re' : 'it’s'} accepted.{' '}
        <Link className="font-bold underline" to="/legal">
          Read and accept
        </Link>
      </p>
    </div>
  )
}

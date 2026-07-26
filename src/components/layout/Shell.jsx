import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { USE_MOCKS } from '../../services/api'
import { clsx } from '../../utils/clsx'
import Logo from './Logo'

/**
 * The authenticated partner shell.
 *
 * Per the designs: a solid-yellow full-height sidebar carrying the logo, the
 * nav, and a Logout pinned to the bottom — sitting on a light grey canvas next
 * to the white content card. The active nav item is a white pill that bleeds
 * past the sidebar's right edge.
 *
 * Nav items are taken verbatim from `list of venues.png`.
 */
// UNTITLED UI: https://www.untitledui.com/react/components/application-shell
const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/venues/new', label: 'Add New' },
  { to: '/venues/declined', label: 'Declined' },
  { to: '/venues/pending', label: 'Pending' },
  { to: '/profile', label: 'Settings' },
]

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0 fill-none stroke-current stroke-[1.75]">
      <circle cx="10" cy="10" r="8.25" />
      <path d="M10 6.5v7M6.5 10h7" strokeLinecap="round" />
    </svg>
  )
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0 fill-none stroke-current stroke-[1.75]">
      <path d="M10 2.5v7" strokeLinecap="round" />
      <path d="M5.6 5.1a6.25 6.25 0 108.8 0" strokeLinecap="round" />
    </svg>
  )
}

export default function Shell() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-full gap-0 bg-canvas p-4">
      <aside className="hidden w-64 shrink-0 flex-col rounded-3xl bg-brand-500 py-8 lg:flex">
        <div className="px-6">
          <Logo />
        </div>

        {/* The active pill bleeds past the sidebar edge, as in the designs. */}
        <nav className="mt-10 flex-1 space-y-1 pl-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-full py-2.5 pl-4 pr-6 text-sm font-bold transition',
                  isActive
                    ? '-mr-4 bg-white text-ink-900 shadow-sm'
                    : 'mr-4 text-white/95 hover:bg-white/20',
                )
              }
            >
              <PlusIcon />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          className="mx-6 flex items-center gap-3 rounded-full py-2 text-sm font-medium text-white/95 transition hover:text-white"
        >
          <PowerIcon />
          Logout
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mb-4 flex items-center justify-between gap-4 rounded-3xl bg-brand-500 px-5 py-3 lg:hidden">
          <Logo size="sm" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm font-medium text-white"
          >
            <PowerIcon />
            Logout
          </button>
        </header>

        {USE_MOCKS && (
          <div className="mb-4 rounded-2xl bg-brand-100 px-6 py-2 text-center text-xs font-medium text-brand-900 lg:ml-4">
            Demo mode — running on in-memory fixtures. The Sho't Right doctypes are not on the bench
            yet; set <code className="font-mono">VITE_USE_MOCKS=false</code> once they are.
          </div>
        )}

        <main className="min-w-0 flex-1 lg:pl-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

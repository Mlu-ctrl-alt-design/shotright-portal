import { useCallback, useRef, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { clsx } from '../../utils/clsx'
import Logo from './Logo'
import NavDrawer from './NavDrawer'

/**
 * The authenticated partner shell.
 *
 * Per the designs: a solid-yellow full-height sidebar carrying the logo, the
 * nav, and a Logout pinned to the bottom — sitting on a light grey canvas next
 * to the white content card. The active nav item is a white pill that bleeds
 * past the sidebar's right edge.
 *
 * TWO PRESENTATIONS, ONE NAV:
 *   lg and up   the permanent sidebar, exactly as designed.
 *   below lg    a hamburger in the header opening a left drawer.
 *
 * The mobile nav used to be a horizontally scrolling row of pills in the
 * header. That works at five items and quietly stops working as the list grows:
 * items scroll off the right edge with nothing saying they are there, and the
 * header claims more vertical space the more the product does. A drawer costs
 * one tap and holds any number of items.
 *
 * `NAV` is defined once and rendered by both. Two copies of a nav list is how
 * an item ends up on desktop and not on mobile.
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

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0 fill-none stroke-current stroke-[1.75]">
      <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 shrink-0 fill-none stroke-current stroke-[1.75]">
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  )
}

export default function Shell() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const triggerRef = useRef(null)

  // Stable identity: NavDrawer's effects depend on it, and a fresh function each
  // render would tear down and rebuild the focus trap on every parent render.
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  /**
   * The active item is not a floating pill — in the designs it is a notch cut
   * out of the sidebar. It is filled with the page canvas (#F7F7F7, not white),
   * rounded on the left only, and bleeds right by exactly the gutter width so
   * it runs flush into the background beside the content card. No shadow: a
   * shadow would make it read as sitting on top of the sidebar rather than
   * being part of the background.
   *
   * The drawer has no content card beside it to bleed into, so there the active
   * item is a plain full pill.
   */
  const navItems = (variant) =>
    NAV.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) =>
          clsx(
            'flex items-center gap-3 py-2.5 pr-6 pl-4 text-sm font-bold transition',
            isActive
              ? variant === 'sidebar'
                ? '-mr-4 rounded-l-full bg-canvas text-ink-900'
                : 'mr-4 rounded-full bg-white text-ink-900'
              : 'mr-4 rounded-full text-ink-900 hover:bg-white/40',
          )
        }
      >
        <PlusIcon />
        {item.label}
      </NavLink>
    ))

  const logoutButton = (className) => (
    <button
      type="button"
      onClick={handleLogout}
      className={clsx(
        'flex items-center gap-3 rounded-full py-2 text-sm font-semibold text-ink-900 transition hover:bg-white/40',
        className,
      )}
    >
      <PowerIcon />
      Logout
    </button>
  )

  return (
    <div className="flex min-h-full gap-0 bg-canvas p-4">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>

      <aside className="hidden w-64 shrink-0 flex-col rounded-3xl bg-brand-500 py-8 lg:flex">
        <div className="px-6">
          <Logo />
        </div>
        <nav aria-label="Main" className="mt-10 flex-1 space-y-1 pl-4">
          {navItems('sidebar')}
        </nav>
        {logoutButton('mx-6')}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mb-4 flex items-center gap-3 rounded-3xl bg-brand-500 px-4 py-3 lg:hidden">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="nav-drawer"
            aria-label="Open menu"
            // 44px minimum touch target — this is the only route to every page
            // other than the current one, so it is the worst control in the app
            // to make fiddly.
            className="grid size-11 shrink-0 place-items-center rounded-full text-ink-900 transition hover:bg-white/40"
          >
            <MenuIcon />
          </button>
          <Logo size="sm" />
        </header>

        <NavDrawer open={drawerOpen} onClose={closeDrawer} triggerRef={triggerRef} label="Main">
          <div id="nav-drawer" className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between gap-3 px-6">
              <Logo size="sm" />
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close menu"
                className="grid size-11 shrink-0 place-items-center rounded-full text-ink-900 transition hover:bg-white/40"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Scrolls independently of the page, so the list can grow past the
                viewport without Logout becoming unreachable. */}
            <nav aria-label="Main" className="mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto pl-4">
              {navItems('drawer')}
            </nav>

            {/* Logout moves in here rather than staying in the header: it
                mirrors the desktop sidebar, and it keeps the mobile header down
                to a trigger and the logo. */}
            <div className="mt-4 border-t border-black/10 pt-4">{logoutButton('mx-6')}</div>
          </div>
        </NavDrawer>

        <main id="main" tabIndex={-1} className="min-w-0 flex-1 lg:pl-4">
          <div className="mx-auto w-full max-w-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

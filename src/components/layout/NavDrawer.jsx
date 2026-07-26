import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Slide-in navigation panel for narrow screens.
 *
 * WHY: the mobile header carried every nav item in a horizontally scrolling
 * row. That works at five items and stops working as the list grows — items
 * scroll off the right edge with no affordance saying so, and the header eats
 * more vertical space the more the product does. A drawer costs one tap and
 * holds an arbitrary number of items.
 *
 * On `lg` and up the permanent sidebar is shown instead and none of this
 * renders, so desktop is untouched.
 *
 * ---
 *
 * A drawer is a modal dialog, and the whole difficulty is in the parts that are
 * invisible when they work. Each of these is load-bearing:
 *
 *  - **Focus is trapped inside while open.** Without it, Tab walks straight out
 *    of the panel and into the page behind — which is still on screen, still
 *    focusable, and now unreachable by pointer because the backdrop covers it.
 *    A keyboard user ends up navigating a page they cannot see.
 *  - **Focus returns to the trigger on close.** Otherwise it resets to the top
 *    of the document, and someone who opened the drawer, changed their mind and
 *    closed it has lost their place entirely.
 *  - **Escape closes.** The expected exit for any modal, and the only one that
 *    does not require finding a target.
 *  - **`aria-modal` + `role="dialog"`** tell a screen reader the rest of the
 *    page is inert. Without it, the content behind is still announced and a
 *    screen-reader user cannot tell the drawer is open at all.
 *  - **The backdrop is a real element**, so tapping outside closes — the second
 *    most-expected exit after Escape.
 *  - **Body scroll is locked.** Otherwise the page behind scrolls under your
 *    finger while the panel stays put, which reads as the app being broken.
 *  - **It closes on navigation.** Tapping a link would otherwise leave the
 *    drawer sitting over the page it just navigated to.
 *
 * Motion respects `prefers-reduced-motion` via the global rule in index.css.
 */
export default function NavDrawer({ open, onClose, triggerRef, label = 'Main', children }) {
  const panelRef = useRef(null)
  const location = useLocation()

  // Close on navigation. Keyed on the resolved location rather than on the link
  // click so it also covers a redirect or a programmatic navigate.
  useEffect(() => {
    if (open) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Close if the viewport grows past the breakpoint. The panel is inside a
  // `lg:hidden` wrapper so it would vanish visually anyway — but `open` would
  // stay true and the body scroll lock with it, leaving a desktop user unable
  // to scroll with nothing on screen to explain why.
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia('(min-width: 64rem)')
    const onChange = (e) => e.matches && onClose()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    // Focus the panel itself rather than its first link: a screen reader then
    // announces the dialog and its label before reading the options, instead of
    // dropping the user onto "Dashboard" with no context.
    panelRef.current?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      // Wrap at both ends. `document.activeElement` rather than event.target so
      // this still works when focus is on the panel container itself.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow

      // Restore focus only if it has fallen to <body> — which is where the
      // browser puts it when the focused element is removed from the DOM.
      //
      // Do NOT test whether focus is still inside the panel: React re-renders
      // (unmounting the panel) BEFORE running this cleanup, so by now the node
      // is detached and that check can never pass. It read as correct and
      // silently did nothing, which is the failure mode this whole component is
      // trying to avoid.
      //
      // The body check also means we never steal focus from something that
      // legitimately claimed it after the drawer closed.
      const target = triggerRef?.current || previouslyFocused
      if (
        (!document.activeElement || document.activeElement === document.body) &&
        target?.isConnected
      ) {
        target.focus?.()
      }
    }
  }, [open, onClose, triggerRef])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0 bg-ink-900/50 motion-safe:animate-[fade-in_150ms_ease-out]"
        onClick={onClose}
        // The backdrop duplicates the Close button and Escape, so it is not the
        // only route out and does not need to be in the tab order.
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-brand-500 py-6
                   shadow-2xl outline-none motion-safe:animate-[slide-in-left_200ms_ease-out]"
      >
        {children}
      </div>
    </div>
  )
}

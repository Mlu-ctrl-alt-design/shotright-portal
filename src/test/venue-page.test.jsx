import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * One venue, one place — and the two menu operations that were missing.
 *
 * A venue used to be scattered across four unrelated URLs with no way between
 * them but the back button. A partner thinks in venues: "the Long Street place"
 * is the unit of work, and the menu, the hours, the photographs and the
 * bookings all belong under it.
 *
 * The menu half of this suite covers a gap nobody had clocked: items could be
 * added and (supposedly) removed, but never CHANGED. A dish priced at R450
 * instead of R45 had to be deleted and retyped — and the delete needed for that
 * goes through `frappe.client.delete`, which the Vendor role almost certainly
 * may not call. So the mistake was, in practice, stuck on the menu.
 */

const VENUE = '/venues/VEN-00001'

const seedItem = () => {
  bench.headings.push({ name: 'PH-1', venue: 'VEN-00001', heading: 'Mains' })
  bench.items.push({
    name: 'PI-1',
    parent_heading: 'PH-1',
    item_name: 'Lamb curry',
    price: 450,
    description: 'With roti',
  })
}

describe('one venue, one place', () => {
  it('opens on an overview of what the listing has', async () => {
    renderApp({ route: VENUE, signedIn: true })

    expect(await screen.findByText(/what’s in this listing/i)).toBeInTheDocument()
  })

  it('names the venue once, above the tabs', async () => {
    renderApp({ route: VENUE, signedIn: true })

    expect(
      await screen.findByRole('heading', { name: 'Corner Kitchen & Bar' }),
    ).toBeInTheDocument()
  })

  it('offers menu, bookings and the rest as tabs', async () => {
    renderApp({ route: VENUE, signedIn: true })

    const nav = await screen.findByRole('navigation', { name: /venue sections/i })
    for (const label of [/overview/i, /details/i, /^menu$/i, /bookings/i, /preview/i]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('moves between them without leaving the venue', async () => {
    const { user } = renderApp({ route: VENUE, signedIn: true })

    const nav = await screen.findByRole('navigation', { name: /venue sections/i })
    await user.click(within(nav).getByRole('link', { name: /^menu$/i }))

    // The tabs are still there, so the partner is inside the venue rather than
    // having been thrown to an unrelated page.
    expect(await screen.findByRole('navigation', { name: /venue sections/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^heading$/i)).toBeInTheDocument()
  })

  it('keeps every old URL working', async () => {
    /* These are in partners' history and in links the wizard and the decline
       screen already navigate to. Nesting the routes must not break one. */
    renderApp({ route: '/venues/VEN-00001/menu', signedIn: true })
    expect(await screen.findByLabelText(/^heading$/i)).toBeInTheDocument()
  })

  it('leads with the decline reason rather than burying it in a tab', async () => {
    /* A decline is not one of five equal destinations — it is the only thing
       that matters about that venue until it is fixed. */
    bench.venues[0].workflow_state = 'Declined'
    renderApp({ route: VENUE, signedIn: true })

    expect(
      await screen.findByRole('link', { name: /see why this venue wasn’t approved/i }),
    ).toBeInTheDocument()
  })
})

describe('bookings', () => {
  it('says it cannot see them, rather than showing an empty diary', async () => {
    /* THE ASSERTION THIS TAB EXISTS FOR. "No bookings yet" and "we can't read
       your bookings" are completely different sentences to a restaurant owner:
       one is a quiet Tuesday, the other is a reason to stop trusting the portal
       on a Friday night. Nothing serves bookings yet, so it must say the
       second. */
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    expect(await screen.findByText(/bookings aren’t switched on yet/i)).toBeInTheDocument()
    expect(screen.getByText(/isn’t an empty diary/i)).toBeInTheDocument()
    expect(screen.getByText(/keep taking bookings the way you do now/i)).toBeInTheDocument()

    /* Production copy, not a status report. A partner never reads who we have
       asked for something, what a method is called, or what a server does or
       doesn't have — that is our process, and it belongs in the backlog. */
    const body = document.body.textContent
    expect(body).not.toMatch(/we’ve asked|we’ve reported|we’ve flagged|shotright\.api|endpoint|server/i)
  })

  it('shows real bookings the day an endpoint answers', async () => {
    bench.deploy.get_venue_bookings = true
    bench.bookings['VEN-00001'] = [
      {
        name: 'BK-1',
        customer_name: 'Nomsa Dlamini',
        booking_datetime: '2026-08-02 19:30:00',
        party_size: 4,
        phone: '+27 82 111 2222',
        status: 'Confirmed',
      },
    ]
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    expect(await screen.findByText(/Nomsa Dlamini/)).toBeInTheDocument()
    expect(screen.getByText(/4 people/)).toBeInTheDocument()
    expect(screen.queryByText(/aren’t switched on yet/i)).not.toBeInTheDocument()
  })

  it('says an empty diary is empty only when it actually knows', async () => {
    bench.deploy.get_venue_bookings = true
    bench.bookings['VEN-00001'] = []
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    expect(await screen.findByText(/no bookings for this venue yet/i)).toBeInTheDocument()
  })
})

describe('edit a menu item', () => {
  it('changes the price on the server', async () => {
    bench.deploy.update_product_item = true
    seedItem()
    const { user } = renderApp({ route: `${VENUE}/menu`, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /edit lamb curry/i }))
    // Scoped to the row's own form — the add-item form further down the card
    // carries the same field labels, so a document-wide query finds two.
    const row = within(screen.getByRole('button', { name: /^save$/i }).closest('form'))
    const price = row.getByLabelText(/price/i)
    await user.clear(price)
    await user.type(price, '45')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(bench.items[0].price).toBe(45))
  })

  it('accepts a decimal price', async () => {
    /* The latitude trap: a controlled input whose value comes from a parsed
       number discards the keystroke that doesn't parse, so "12." loses its
       point and a decimal can never be typed. Prices have decimals. */
    bench.deploy.update_product_item = true
    seedItem()
    const { user } = renderApp({ route: `${VENUE}/menu`, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /edit lamb curry/i }))
    const row = within(screen.getByRole('button', { name: /^save$/i }).closest('form'))
    const price = row.getByLabelText(/price/i)
    await user.clear(price)
    await user.type(price, '45.50')

    expect(price).toHaveValue('45.50')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(bench.items[0].price).toBe(45.5))
  })

  it('changes the name and description too', async () => {
    bench.deploy.update_product_item = true
    seedItem()
    const { user } = renderApp({ route: `${VENUE}/menu`, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /edit lamb curry/i }))
    const row = within(screen.getByRole('button', { name: /^save$/i }).closest('form'))
    const name = row.getByLabelText(/^item$/i)
    await user.clear(name)
    await user.type(name, 'Mutton curry')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(bench.items[0].item_name).toBe('Mutton curry'))
    expect(await screen.findByText('Mutton curry')).toBeInTheDocument()
  })

  it('keeps their words on screen when the bench has no way to save them', async () => {
    /* Today's reality: no update endpoint exists. Losing what they typed on top
       of that would mean retyping a description from nothing. */
    seedItem()
    const { user } = renderApp({ route: `${VENUE}/menu`, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /edit lamb curry/i }))
    const form = screen.getByRole('button', { name: /^save$/i }).closest('form')
    await user.clear(within(form).getByLabelText(/^item$/i))
    await user.type(within(form).getByLabelText(/^item$/i), 'Mutton curry')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText(/can’t change a menu item just yet/i)).toBeInTheDocument()
    expect(within(form).getByLabelText(/^item$/i)).toHaveValue('Mutton curry')
  })

  it('leaves the item alone when the edit is cancelled', async () => {
    bench.deploy.update_product_item = true
    seedItem()
    const { user } = renderApp({ route: `${VENUE}/menu`, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /edit lamb curry/i }))
    const form = screen.getByRole('button', { name: /^save$/i }).closest('form')
    await user.clear(within(form).getByLabelText(/^item$/i))
    await user.type(within(form).getByLabelText(/^item$/i), 'Something else')
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(await screen.findByText('Lamb curry')).toBeInTheDocument()
    expect(bench.items[0].item_name).toBe('Lamb curry')
  })
})

describe('remove a menu item', () => {
  it('uses the whitelisted method when there is one', async () => {
    bench.deploy.delete_product_item = true
    seedItem()
    const { user } = renderApp({ route: `${VENUE}/menu`, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /remove lamb curry/i }))

    await waitFor(() => expect(bench.items).toHaveLength(0))
  })

  it('does not pretend to have removed something it could not', async () => {
    /* The Vendor role has no doctype access — the same wall that broke photo
       attachment — so `frappe.client.delete` is refused. A row that vanishes
       from the screen and stays on the customer's menu is the failure this
       guards against. */
    bench.deploy.delete_product_item = false
    bench.deploy['frappe.client.delete'] = false
    seedItem()
    const { user } = renderApp({ route: `${VENUE}/menu`, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /remove lamb curry/i }))

    await new Promise((r) => setTimeout(r, 400))
    expect(bench.items).toHaveLength(1)
    expect(screen.getByText('Lamb curry')).toBeInTheDocument()
  })
})

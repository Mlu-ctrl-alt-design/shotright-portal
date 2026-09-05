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

/**
 * A local `YYYY-MM-DD`, written out longhand rather than imported from the
 * service it checks.
 *
 * `toISOString()` is UTC and South Africa is UTC+2, so between midnight and
 * 02:00 it names yesterday — the exact hours a late venue is still open and
 * most likely to be looking at tomorrow's book. Two independent implementations
 * is the point: if the service ever drifts to UTC, the fixture and the request
 * stop agreeing and the suite says so.
 */
const day = (offset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const booking = (over = {}) => ({
  name: 'BK-1',
  arrival_date: day(),
  arrival_time: '19:30:00',
  adults: 4,
  children: 0,
  contact_name: 'Nomsa Dlamini',
  contact_cell_phone: '+27 82 111 2222',
  ...over,
})

const bookingCalls = () => bench.calls.filter((c) => c.method === 'get_venue_bookings')

describe('bookings', () => {
  it('says it cannot see them, rather than showing an empty diary', async () => {
    /* THE ASSERTION THIS TAB EXISTS FOR, and it outlives the endpoint shipping:
       partners' benches update at different times, so a portal one release
       ahead of a server still has to say the honest thing. "No bookings yet"
       and "we can't read your bookings" are completely different sentences to a
       restaurant owner — one is a quiet Tuesday, the other is a reason to stop
       trusting the portal on a Friday night. */
    bench.deploy.get_venue_bookings = false
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

  it('shows who is coming, from the fields the endpoint actually returns', async () => {
    bench.bookings['VEN-00001'] = [booking()]
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    expect(await screen.findByText('Nomsa Dlamini')).toBeInTheDocument()
    expect(screen.getByText('19:30')).toBeInTheDocument()
    expect(screen.getByText(/4 people/)).toBeInTheDocument()
    expect(screen.queryByText(/aren’t switched on yet/i)).not.toBeInTheDocument()
  })

  it('puts the phone number one tap from dialling', async () => {
    /* A booking sheet you have to retype numbers off is a booking sheet that
       stays on paper. */
    bench.bookings['VEN-00001'] = [booking()]
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    const call = await screen.findByRole('link', { name: '+27 82 111 2222' })
    expect(call).toHaveAttribute('href', 'tel:+27821112222')
  })

  it('asks for today onwards, and never for more than the server will give', async () => {
    bench.bookings['VEN-00001'] = [booking()]
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })
    await screen.findByText('Nomsa Dlamini')

    const [{ args }] = bookingCalls()
    expect(args.from_date).toBe(day())
    expect(args.to_date).toBeUndefined()
    /* The service caps at 500 and cints whatever arrives. Asking for more than
       it will return would make a truncated list look complete. */
    expect(Number(args.limit)).toBeLessThanOrEqual(500)
  })

  it('groups by day and says which day is today', async () => {
    bench.bookings['VEN-00001'] = [
      booking({ name: 'BK-1', arrival_time: '19:30:00' }),
      booking({ name: 'BK-2', arrival_date: day(1), arrival_time: '12:00:00', contact_name: 'Sipho Khumalo' }),
    ]
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    expect(await screen.findByRole('heading', { name: /^today ·/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^tomorrow ·/i })).toBeInTheDocument()
  })

  it('orders the evening forwards', async () => {
    /* A service runs forwards. A list that opens on the 21:00 table is a list
       somebody has to re-sort in their head at the door. */
    bench.bookings['VEN-00001'] = [
      booking({ name: 'BK-1', arrival_time: '21:00:00', contact_name: 'Late Table' }),
      booking({ name: 'BK-2', arrival_time: '18:00:00', contact_name: 'Early Table' }),
    ]
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    await screen.findByText('Early Table')
    const names = screen.getAllByText(/Table$/).map((n) => n.textContent)
    expect(names).toEqual(['Early Table', 'Late Table'])
  })

  it('trusts the server’s party size and names children separately', async () => {
    /* `party_size` is computed server-side and `booking_register.py` computes
       it the same way. Two surfaces disagreeing about whether children count
       toward covers is the bug worth not having — so we show the server's
       number, and split it out only when there ARE children, because a high
       chair is a different table. */
    bench.bookings['VEN-00001'] = [booking({ adults: 2, children: 3 })]
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    expect(await screen.findByText(/5 people · 2 adults, 3 children/)).toBeInTheDocument()
  })

  it('never badges a booking as confirmed, because nothing says it is', async () => {
    /* The endpoint returns no status and is not gated on workflow_state. A
       "Confirmed" badge would be us making a promise on the server's behalf. */
    bench.bookings['VEN-00001'] = [booking()]
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    await screen.findByText('Nomsa Dlamini')
    expect(screen.queryByText(/confirmed|pending|declined/i)).not.toBeInTheDocument()
  })

  it('can look back at earlier bookings without losing today', async () => {
    /* Upcoming is the working view. Earlier exists so "where did Friday's
       booking go?" has an answer other than us having quietly hidden it. */
    bench.bookings['VEN-00001'] = [
      booking({ name: 'BK-1', contact_name: 'Tonight' }),
      booking({ name: 'BK-2', arrival_date: day(-3), contact_name: 'Last Week' }),
    ]
    const { user } = renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    await screen.findByText('Tonight')
    expect(screen.queryByText('Last Week')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /earlier/i }))

    expect(await screen.findByText('Last Week')).toBeInTheDocument()
    expect(screen.queryByText('Tonight')).not.toBeInTheDocument()

    const past = bookingCalls().at(-1).args
    expect(past.to_date).toBe(day(-1))
    expect(past.from_date).toBeUndefined()
  })

  it('offers a way back when the read fails, instead of an empty diary', async () => {
    /* Deployed and throwing is a bad minute, not a missing feature — so the way
       out is to try again, not an explanation of our roadmap. Ownership is
       checked server-side, so an unknown venue throws rather than answering
       with an empty list, which would read as "you have no bookings". */
    renderApp({ route: '/venues/NOT-MINE/bookings', signedIn: true })

    expect(await screen.findByText(/couldn’t load your bookings just now/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing has changed about them/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.queryByText(/no one is booked in yet/i)).not.toBeInTheDocument()
  })

  it('says an empty diary is empty only when it actually knows', async () => {
    bench.bookings['VEN-00001'] = []
    renderApp({ route: `${VENUE}/bookings`, signedIn: true })

    expect(await screen.findByText(/no one is booked in yet/i)).toBeInTheDocument()
    /* And it is not hedged. Once the server has answered, this is a fact about
       the diary, so saying it plainly is the honest thing. */
    expect(screen.queryByText(/aren’t switched on yet/i)).not.toBeInTheDocument()
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

    expect(await screen.findByText(/can’t change a menu item yet/i)).toBeInTheDocument()
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

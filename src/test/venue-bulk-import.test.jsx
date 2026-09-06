/**
 * Many venues from one spreadsheet.
 *
 * The assertions that matter are the ones about what does NOT happen. A venue
 * is not a menu item: it enters a review queue, it is what customers see, and
 * it cannot be reliably deleted afterwards - `frappe.client.delete` is not a
 * permission the Vendor role can be counted on to have. Creating eleven venues
 * and then explaining is not recoverable the way "remove that dish" is.
 */
import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

const ROUTE = '/venues/import'
const HEADER =
  'venue_name,address,latitude,longitude,moods,dress_code,atmosphere,weekday_open,weekday_close,weekend_open,weekend_close'

const csv = (body) => new File([HEADER + '\n' + body], 'venues.csv', { type: 'text/csv' })

const upload = async (user, file) => {
  await user.upload(await screen.findByLabelText(/venue spreadsheet/i), file)
}

const GOOD =
  'Corner Kitchen,12 Long St,-33.92,18.42,Chilled,Smart casual,Low light,17:00,23:00,12:00,23:00'
const YARD =
  'The Yard,8 Sydney Rd,-33.93,18.47,Lively,Casual,Loud,16:00,23:00,16:00,23:00'

describe('reading the file', () => {
  it('shows what it understood before creating anything', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.venues.length

    await upload(user, csv(GOOD))

    expect(await screen.findByText(/1 ready to add/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing has been created yet/i)).toBeInTheDocument()
    expect(bench.venues).toHaveLength(before)
  })

  /**
   * The bench refuses an unknown mood outright - "Unknown mood: Nope" - so a
   * typo in one cell would otherwise fail the whole venue after a round trip,
   * with the partner none the wiser about which word was wrong.
   */
  it('catches a mood we do not have, by name, before sending', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.venues.length

    await upload(user, csv('The Yard,8 Sydney Rd,,,Raucous,Casual,Loud,16:00,23:00,16:00,23:00'))

    expect(await screen.findByText(/not one we have: Raucous/i)).toBeInTheDocument()
    expect(bench.venues).toHaveLength(before)
  })

  /* Two rows naming the same venue splits that venue's bookings across two
     listings whose owner sees neither half. Flagged on the second. */
  it('flags a repeated name against the line it first appeared on', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv(GOOD + '\n' + GOOD))

    expect(await screen.findByText(/same name as line 2/i)).toBeInTheDocument()
    expect(screen.getByText(/1 ready to add/i)).toBeInTheDocument()
  })

  /* Excel writes times several ways and partners type others. All the same
     o'clock. */
  it.each(['5:00 PM', '17:00', '17:00:00'])('reads %s as a closing time', async (written) => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(
      user,
      csv('Late Bar,1 Main Rd,,,Chilled,Casual,Busy,09:00,' + written + ',09:00,' + written),
    )

    expect(await screen.findByText(/1 ready to add/i)).toBeInTheDocument()
  })

  /**
   * `file.text()` on a real .xlsx returns binary, which parses into nonsense
   * rows and then blames the partner for them. Refused with the two clicks that
   * fix it instead.
   */
  it('does not pretend to read a real Excel file', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(
      user,
      new File(['PKbinary'], 'venues.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    )

    expect(await screen.findByText(/Save As/i)).toBeInTheDocument()
    expect(screen.queryByText(/ready to add/i)).not.toBeInTheDocument()
  })
})

describe('creating them', () => {
  it('creates every ready row, and says so line by line', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.venues.length

    await upload(user, csv(GOOD + '\n' + YARD))
    await user.click(await screen.findByRole('button', { name: /add 2 venues/i }))

    await waitFor(() => expect(bench.venues).toHaveLength(before + 2))
    expect(await screen.findByText(/2 venues added/i)).toBeInTheDocument()
    expect(bench.venues.some((v) => v.venue_name === 'Corner Kitchen')).toBe(true)
    expect(bench.venues.some((v) => v.venue_name === 'The Yard')).toBe(true)
  })

  /* A blocked row is never sent, so a file that is half wrong still gets the
     half that is right. */
  it('sends only the rows that were ready', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.venues.length

    await upload(user, csv(GOOD + '\nBroken,,,,Nope,Casual,x,17:00,23:00,17:00,23:00'))
    await user.click(await screen.findByRole('button', { name: /add 1 venue/i }))

    await waitFor(() => expect(bench.venues).toHaveLength(before + 1))
    expect(bench.venues.some((v) => v.venue_name === 'Broken')).toBe(false)
  })

  /**
   * A venue with no coordinates saves perfectly well and is invisible to a
   * customer searching nearby. `createVenue` already warns about that for a
   * single venue; arriving in a spreadsheet must not make it quieter.
   */
  it('passes on the warning about a venue with no map location', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv('No Pin,4 Bree St,,,Chilled,Casual,Quiet,17:00,23:00,17:00,23:00'))
    await user.click(await screen.findByRole('button', { name: /add 1 venue/i }))

    expect(await screen.findByText(/1 venue added/i)).toBeInTheDocument()
    expect(screen.getByText(/will not appear when customers search/i)).toBeInTheDocument()
  })

  /* Photos are required before a venue can go for review, and this path cannot
     carry one. Said once, plainly, rather than discovered later. */
  it('says the new venues still need a photo', async () => {
    const { user } = renderApp({ route: ROUTE, signedIn: true })

    await upload(user, csv(GOOD))
    await user.click(await screen.findByRole('button', { name: /add 1 venue/i }))

    expect(await screen.findByText(/still needs at least one photo/i)).toBeInTheDocument()
  })

  /**
   * One failure must not end the run. Stopping at the first bad venue leaves a
   * partner with four of eleven created, no record of which four, and a file
   * they dare not upload again.
   */
  it('keeps going past a venue the server refused, and names it', async () => {
    bench.createVenueRefuses = 'The Yard'
    const { user } = renderApp({ route: ROUTE, signedIn: true })
    const before = bench.venues.length

    await upload(user, csv(YARD + '\n' + GOOD))
    await user.click(await screen.findByRole('button', { name: /add 2 venues/i }))

    expect(await screen.findByText(/1 venue added/i)).toBeInTheDocument()
    await waitFor(() => expect(bench.venues).toHaveLength(before + 1))

    const notAdded = screen.getByRole('heading', { name: /not added/i }).parentElement
    expect(within(notAdded).getByText('The Yard')).toBeInTheDocument()
  })
})

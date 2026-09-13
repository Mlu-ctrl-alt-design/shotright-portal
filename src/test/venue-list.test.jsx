import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench, VENUE_ONE } from './bench'

/**
 * The venue list: each row shows the listing's face, and the actions column
 * holds ONE visible action with the rest behind a "⋯" overflow.
 *
 * The cover image rides on `get_vendor_dashboard` (added 23 Aug) precisely so
 * this screen costs no photo request per row — so these tests assert against
 * the dashboard payload, not a photos read.
 */

const LIST = '/venues'

const pushDeclined = () =>
  bench.venues.push({
    name: 'VEN-00002',
    venue_name: 'Backyard Braai',
    address: '9 Vilakazi St, Soweto',
    workflow_state: 'Declined',
    dress_code: 'Casual',
    moods: [],
    operating_hours: [],
  })

const rowFor = async (venueName) => {
  const cell = await screen.findByText(venueName)
  return cell.closest('tr')
}

describe('venue list covers', () => {
  it('shows the cover photo the dashboard sent for the venue', async () => {
    renderApp({ route: LIST, signedIn: true })

    const row = await rowFor('Corner Kitchen & Bar')
    const img = row.querySelector(`img[src="${VENUE_ONE.cover_image}"]`)
    expect(img).not.toBeNull()
  })

  it('a venue with no cover gets its initial, never a broken image', async () => {
    pushDeclined() // seeded without cover_image, like a venue with no photos yet
    renderApp({ route: LIST, signedIn: true })

    const row = await rowFor('Backyard Braai')
    expect(row.querySelector('img')).toBeNull()
    expect(within(row).getByText('B')).toBeInTheDocument()
  })
})

describe('venue list actions', () => {
  it('keeps one action visible and the rest behind the overflow', async () => {
    const { user } = renderApp({ route: LIST, signedIn: true })

    // Approved venue: Edit is the primary…
    expect(
      await screen.findByRole('link', { name: 'Edit Corner Kitchen & Bar' }),
    ).toBeInTheDocument()
    // …and Preview/Menu are NOT in the row until asked for.
    expect(
      screen.queryByRole('link', { name: /Preview Corner Kitchen & Bar/ }),
    ).toBeNull()
    expect(screen.queryByRole('link', { name: 'Menu for Corner Kitchen & Bar' })).toBeNull()

    const toggle = screen.getByRole('button', { name: 'More actions for Corner Kitchen & Bar' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('link', { name: /Preview Corner Kitchen & Bar/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Menu for Corner Kitchen & Bar' })).toBeInTheDocument()
    // Edit is already in the open for an approved venue — it must not repeat
    // inside the overflow, or the row offers the same door twice.
    expect(screen.getAllByRole('link', { name: 'Edit Corner Kitchen & Bar' })).toHaveLength(1)
  })

  it('a declined venue leads with Why? and keeps Edit in the overflow', async () => {
    pushDeclined()
    const { user } = renderApp({ route: LIST, signedIn: true })

    const row = await rowFor('Backyard Braai')
    // The state-specific answer holds the primary slot…
    expect(
      within(row).getByRole('link', { name: 'Why Backyard Braai was declined' }),
    ).toBeInTheDocument()
    // …so Edit is not in the open for this row.
    expect(screen.queryByRole('link', { name: 'Edit Backyard Braai' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'More actions for Backyard Braai' }))
    expect(screen.getByRole('link', { name: 'Edit Backyard Braai' })).toBeInTheDocument()
  })

  it('Escape closes the overflow and hands focus back to its button', async () => {
    const { user } = renderApp({ route: LIST, signedIn: true })

    const toggle = await screen.findByRole('button', {
      name: 'More actions for Corner Kitchen & Bar',
    })
    await user.click(toggle)
    expect(screen.getByRole('link', { name: 'Menu for Corner Kitchen & Bar' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Menu for Corner Kitchen & Bar' })).toBeNull(),
    )
    expect(toggle).toHaveFocus()
  })
})

describe('on a phone', () => {
  /**
   * ⚠️ MEASURED, NOT GUESSED. Driving the real app at 390x844: the venue table
   * is 534px wide inside a horizontal scroller, so "Dress code" was clipped and
   * the ENTIRE Actions column — Edit, Why?, Progress and the overflow menu —
   * sat off-screen, with nothing on screen to say the table scrolled sideways.
   * A partner on a phone could not reach a single action on their own venue.
   *
   * `useIsPhone` swaps the table for cards rather than hiding one with CSS, so
   * only one layout is ever in the DOM. That is why these tests can tell which
   * links a partner would actually be able to press.
   */
  const asPhone = () => {
    window.matchMedia = (query) => ({
      matches: /max-width:\s*639px/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })
  }

  it('drops the table, so nothing lives off the side of the screen', async () => {
    asPhone()
    renderApp({ route: '/venues', signedIn: true })

    await screen.findByText(VENUE_ONE.venue_name)
    expect(document.querySelector('table')).toBeNull()
  })

  it('keeps every venue’s action reachable', async () => {
    asPhone()
    renderApp({ route: '/venues', signedIn: true })

    await screen.findByText(VENUE_ONE.venue_name)

    /* The same one-in-the-open rule as the table: a primary action and the ⋯,
       shared from `VenueActions` so the two layouts cannot disagree about
       which one a venue gets. */
    expect(
      await screen.findByRole('link', { name: new RegExp(`Edit ${VENUE_ONE.venue_name}`, 'i') }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: new RegExp(`More actions for ${VENUE_ONE.venue_name}`, 'i'),
      }),
    ).toBeInTheDocument()
  })

  it('still says what state each venue is in', async () => {
    asPhone()
    renderApp({ route: '/venues', signedIn: true })

    await screen.findByText(VENUE_ONE.venue_name)
    expect(screen.getAllByText(/approved|pending|declined|draft/i).length).toBeGreaterThan(0)
  })
})

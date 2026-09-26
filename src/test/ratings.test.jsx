import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * Guest ratings, and the venue's one reply (shotright PR #57).
 *
 * The portal has no inbox, so the tab badge and the dashboard banner are how a
 * partner learns a guest is waiting on them — those are tested as carefully as
 * the reply itself.
 */

const RATINGS = '/venues/VEN-00001/ratings'

const rating = (name, overrides = {}) => ({
  name,
  venue: 'VEN-00001',
  score: 4,
  comment: 'Lovely evening',
  customer_first_name: 'Thandi',
  visit_date: '2026-09-20',
  submitted_on: `2026-09-2${name.slice(-1)} 10:00:00`,
  reply: null,
  replied_on: null,
  is_flagged: 0,
  ...overrides,
})

describe('the ratings tab', () => {
  it('lists ratings with first name, stars and comment, newest first', async () => {
    bench.ratings.push(
      rating('VR-1', { score: 2, comment: 'Cold food', customer_first_name: 'Sipho' }),
      rating('VR-2', { score: 5 }),
    )
    renderApp({ route: RATINGS, signedIn: true })

    await screen.findByText('Sipho')
    const rows = screen.getAllByLabelText(/out of 5/).map((stars) => stars.closest('li'))
    expect(within(rows[0]).getByText('Thandi')).toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('5 out of 5')).toBeInTheDocument()
    expect(within(rows[1]).getByText('“Cold food”')).toBeInTheDocument()
  })

  it('shows the raw average, and says customers cannot see it yet below three', async () => {
    bench.ratings.push(rating('VR-1', { score: 5 }), rating('VR-2', { score: 4 }))
    renderApp({ route: RATINGS, signedIn: true })

    expect(await screen.findByText('4.5')).toBeInTheDocument()
    expect(screen.getByText(/from 2 ratings/i)).toBeInTheDocument()
    expect(screen.getByText(/customers see your average once you have 3 ratings/i)).toBeInTheDocument()
  })

  it('drops the threshold note once customers can see the average', async () => {
    bench.ratings.push(rating('VR-1'), rating('VR-2'), rating('VR-3'))
    renderApp({ route: RATINGS, signedIn: true })

    expect(await screen.findByText(/from 3 ratings/i)).toBeInTheDocument()
    expect(screen.queryByText(/customers see your average/i)).not.toBeInTheDocument()
  })

  it('says so when there are none — which is not the same as switched off', async () => {
    renderApp({ route: RATINGS, signedIn: true })

    expect(await screen.findByText(/no ratings yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/aren’t switched on/i)).not.toBeInTheDocument()
  })

  it('on a bench without ratings, says they are not switched on', async () => {
    bench.deploy.get_venue_ratings = false
    renderApp({ route: RATINGS, signedIn: true })

    expect(await screen.findByText(/ratings aren’t switched on yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/no ratings yet/i)).not.toBeInTheDocument()
  })

  it('shows a hidden rating without its comment, and offers no reply', async () => {
    bench.ratings.push(rating('VR-1', { is_flagged: 1, comment: 'something abusive' }))
    renderApp({ route: RATINGS, signedIn: true })

    expect(await screen.findByText(/hidden by sho’t right/i)).toBeInTheDocument()
    expect(screen.queryByText(/something abusive/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^reply$/i })).not.toBeInTheDocument()
  })
})

describe('replying', () => {
  it('saves a reply and shows it under the rating', async () => {
    bench.ratings.push(rating('VR-1'))
    const { user } = renderApp({ route: RATINGS, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /^reply$/i }))
    await user.type(screen.getByLabelText(/your reply to thandi/i), '  Thank you for coming!  ')
    await user.click(screen.getByRole('button', { name: /save reply/i }))

    expect(await screen.findByText('Thank you for coming!')).toBeInTheDocument()
    expect(bench.ratings[0].reply).toBe('Thank you for coming!')
    expect(screen.getByRole('button', { name: /edit reply/i })).toBeInTheDocument()
  })

  it('edits an existing reply, prefilled', async () => {
    bench.ratings.push(rating('VR-1', { reply: 'Thanks', replied_on: '2026-09-21 09:00:00' }))
    const { user } = renderApp({ route: RATINGS, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /edit reply/i }))
    const box = screen.getByLabelText(/your reply to thandi/i)
    expect(box).toHaveValue('Thanks')
    expect(screen.getByText(/saving replaces your earlier reply/i)).toBeInTheDocument()

    await user.clear(box)
    await user.type(box, 'Thanks — see you soon')
    await user.click(screen.getByRole('button', { name: /save reply/i }))

    await waitFor(() => expect(bench.ratings[0].reply).toBe('Thanks — see you soon'))
  })

  it('cannot send an empty reply', async () => {
    bench.ratings.push(rating('VR-1'))
    const { user } = renderApp({ route: RATINGS, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /^reply$/i }))
    await user.type(screen.getByLabelText(/your reply/i), '   ')

    expect(screen.getByRole('button', { name: /save reply/i })).toBeDisabled()
    expect(bench.calls.some((c) => c.method === 'reply_to_venue_rating')).toBe(false)
  })

  it("puts the bench's refusal on screen", async () => {
    bench.ratings.push(rating('VR-1'))
    const { user } = renderApp({ route: RATINGS, signedIn: true })
    await user.click(await screen.findByRole('button', { name: /^reply$/i }))
    // Hidden by an admin while the partner was typing.
    bench.ratings[0].is_flagged = 1

    await user.type(screen.getByLabelText(/your reply/i), 'Sorry')
    await user.click(screen.getByRole('button', { name: /save reply/i }))

    expect(await screen.findByText(/cannot be replied to/i)).toBeInTheDocument()
  })

  it('"Awaiting reply" leaves out answered and hidden ratings', async () => {
    bench.ratings.push(
      rating('VR-1', { reply: 'Thanks', customer_first_name: 'Answered' }),
      rating('VR-2', { is_flagged: 1, customer_first_name: 'Hidden' }),
      rating('VR-3', { customer_first_name: 'Waiting' }),
    )
    const { user } = renderApp({ route: RATINGS, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /awaiting reply \(1\)/i }))

    expect(await screen.findByText('Waiting')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Answered')).not.toBeInTheDocument())
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })
})

describe('finding out a guest is waiting', () => {
  it('badges the Ratings tab with the unreplied count', async () => {
    bench.ratings.push(rating('VR-1'), rating('VR-2'), rating('VR-3', { reply: 'Thanks' }))
    renderApp({ route: '/venues/VEN-00001', signedIn: true })

    const tab = await screen.findByRole('link', { name: /ratings/i })
    expect(await within(tab).findByLabelText('2 awaiting a reply')).toHaveTextContent('2')
  })

  it('puts a banner on the dashboard that opens the venue’s ratings', async () => {
    bench.ratings.push(rating('VR-1'))
    const { user } = renderApp({ route: '/', signedIn: true })

    await user.click(await screen.findByRole('link', { name: /1 guest rating is waiting for your reply/i }))

    expect(await screen.findByRole('button', { name: /^reply$/i })).toBeInTheDocument()
  })

  it('shows no banner when nothing is waiting', async () => {
    bench.ratings.push(rating('VR-1', { reply: 'Thanks' }))
    renderApp({ route: '/', signedIn: true })

    await screen.findByText(/your venues/i)
    expect(screen.queryByText(/waiting for your reply/i)).not.toBeInTheDocument()
  })
})

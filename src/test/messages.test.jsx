import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * The Messages panel: the partner's Notification Log — new bookings,
 * cancellations, ratings — which until now reached them only by email.
 * Bodies are HTML on the bench (live example below) and must read as text.
 */

const entry = (name, overrides = {}) => ({
  name,
  subject: 'New booking at Coco Melon',
  type: 'Alert',
  read: 0,
  creation: `2026-09-2${name.slice(-1)} 10:00:00`,
  email_content:
    '<p><strong>Zuko</strong> booked a table at <strong>Coco Melon</strong>.</p><p>2026-09-21 at 15:00, party of 3.</p>',
  ...overrides,
})

describe('the Messages panel', () => {
  it('is in the nav with the unread count, and lists messages newest first', async () => {
    bench.inbox.push(
      entry('NL-1', { subject: 'Booking cancelled: dingo on 2026-08-28', read: 1 }),
      entry('NL-2', { subject: 'New 4-star rating for Coco Melon' }),
      entry('NL-3'),
    )
    renderApp({ route: '/messages', signedIn: true })

    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]
    expect(await within(nav).findByRole('link', { name: /messages, 2 unread/i })).toBeInTheDocument()
    const rows = await screen.findAllByRole('listitem')
    expect(rows.map((r) => within(r).getByRole('button').textContent)).toEqual([
      expect.stringContaining('New booking at Coco Melon'),
      expect.stringContaining('New 4-star rating for Coco Melon'),
      expect.stringContaining('Booking cancelled'),
    ])
  })

  it('opens a message as text, not HTML, and marks it read', async () => {
    bench.inbox.push(entry('NL-1'))
    const user = userEvent.setup()
    renderApp({ route: '/messages', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /new booking at coco melon/i }))

    expect(await screen.findByText('Zuko booked a table at Coco Melon.')).toBeInTheDocument()
    expect(screen.getByText('2026-09-21 at 15:00, party of 3.')).toBeInTheDocument()
    expect(screen.queryByText(/<p>|<strong>/)).not.toBeInTheDocument()
    await waitFor(() =>
      expect(bench.calls).toContainEqual({ method: 'mark_inbox_read', args: { name: 'NL-1' } }),
    )
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^messages$/i })).toBeInTheDocument())
  })

  it('marks everything read in one go', async () => {
    bench.inbox.push(entry('NL-1'), entry('NL-2'))
    const user = userEvent.setup()
    renderApp({ route: '/messages', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /mark all as read/i }))

    await waitFor(() => expect(bench.inbox.every((e) => e.read)).toBe(true))
    expect(screen.queryByRole('button', { name: /mark all as read/i })).not.toBeInTheDocument()
  })

  it('still reads messages on a bench without mark_inbox_read', async () => {
    bench.deploy.mark_inbox_read = false
    bench.inbox.push(entry('NL-1'))
    const user = userEvent.setup()
    renderApp({ route: '/messages', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /new booking at coco melon/i }))

    expect(await screen.findByText('Zuko booked a table at Coco Melon.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when there is nothing yet', async () => {
    renderApp({ route: '/messages', signedIn: true })

    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument()
  })
})

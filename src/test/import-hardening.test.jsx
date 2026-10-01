import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from './render'
import { bench } from './bench'
import { addPhoto, fillPage, saveAndAddPhotos, sendForReview } from './addVenue'

/**
 * Single-venue import after the 1 Oct hardening (shotright feat/import-hardening).
 *
 * What a logged-out read of each source really gives was checked against the
 * live sites: Instagram redirects to a login page, Facebook gives a name and a
 * city, a website gives whatever its schema.org block declares. These tests
 * pin the portal to what the bench now answers for each.
 */

const asPro = () => {
  bench.deploy.import_venue_from_url = true
  bench.deploy.get_entitlements = true
  bench.entitlements = {
    plan: 'pro',
    features: ['venue_import_google', 'venue_import_social', 'venue_import_website', 'venue_bulk_import'],
  }
}

const WEEK = [
  ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((day_of_week) => ({
    day_of_week,
    open_time: '12:00:00',
    close_time: '22:00:00',
  })),
  { day_of_week: 'Saturday', open_time: '10:00:00', close_time: '23:30:00' },
  { day_of_week: 'Sunday', open_time: '10:00:00', close_time: '23:30:00' },
]

async function readLink(user, tab, label, link) {
  renderApp({ route: '/venues/new', signedIn: true })
  await user.click(await screen.findByRole('tab', { name: tab }))
  await user.type(screen.getByLabelText(label), link)
  await user.click(screen.getByRole('button', { name: /read it/i }))
}

describe('social pages behind a login', () => {
  it('says so, in the bench’s words, and fills nothing in', async () => {
    asPro()
    const link = 'https://www.instagram.com/nomsa'
    bench.importedByUrl = {
      [link]: {
        platform: 'instagram',
        blocked: true,
        name: '',
        message: 'Instagram only shows this page to people who are logged in, so we couldn’t read it.',
      },
    }
    const user = userEvent.setup()
    await readLink(user, /facebook or instagram/i, /paste your page link/i, link)

    expect(await screen.findByText(/that page is behind a login/i)).toBeInTheDocument()
    expect(screen.getByText(/only shows this page to people who are logged in/i)).toBeInTheDocument()
    // Still on the import screen: nothing was imported, least of all a venue called "Instagram".
    expect(screen.queryByDisplayValue('Instagram')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /venue name/i })).not.toBeInTheDocument()
  })

  it('accepts a link typed the way people type links', async () => {
    asPro()
    bench.importedByUrl = { 'facebook.com/nomsa': { platform: 'facebook', blocked: false, name: 'Nomsa’s' } }
    const user = userEvent.setup()
    await readLink(user, /facebook or instagram/i, /paste your page link/i, 'facebook.com/nomsa')

    await screen.findByDisplayValue('Nomsa’s')
    const call = bench.calls.find((c) => c.method === 'import_venue_from_url' && c.args.url)
    expect(call.args.url).toBe('facebook.com/nomsa')
  })
})

describe('the bench refusing a free account', () => {
  it('reads as a Pro feature, not as a broken page', async () => {
    asPro()
    bench.importLocked = true
    const user = userEvent.setup()
    await readLink(user, /your website/i, /your website/i, 'https://nomsa.co.za')

    expect(await screen.findByText(/importing is a pro feature/i)).toBeInTheDocument()
    expect(screen.queryByText(/that didn’t work/i)).not.toBeInTheDocument()
  })
})

describe('imported opening hours', () => {
  it('are the hours that get saved, not just the hours that get shown', async () => {
    /* Until 1 Oct the wizard showed "Mon 12:00–22:00" from the listing and
       saved its own 11:00–23:00 default, Monday to Friday. */
    asPro()
    const site = 'https://nomsa.co.za'
    bench.importedByUrl = { [site]: { platform: 'website', blocked: false, name: 'Nomsa’s', operating_hours: WEEK } }
    const user = userEvent.setup()
    await readLink(user, /your website/i, /your website/i, site)
    await screen.findByDisplayValue('Nomsa’s')
    expect(screen.getByText(/Mon 12:00–22:00/)).toBeInTheDocument()

    await fillPage(user)
    await saveAndAddPhotos(user)
    await addPhoto(user)
    await sendForReview(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    const created = bench.calls.find((c) => c.method === 'create_venue').args
    const rows = typeof created.operating_hours === 'string' ? JSON.parse(created.operating_hours) : created.operating_hours
    expect(rows).toHaveLength(7)
    expect(rows.find((r) => r.day_of_week === 'Monday')).toMatchObject({ open_time: '12:00:00', close_time: '22:00:00' })
    expect(rows.find((r) => r.day_of_week === 'Sunday')).toMatchObject({ open_time: '10:00:00', close_time: '23:30:00' })
  })

  it('that the editor cannot hold are not shown as if they were filled in', async () => {
    asPro()
    const site = 'https://split.co.za'
    bench.importedByUrl = {
      [site]: {
        platform: 'website',
        blocked: false,
        name: 'Split Shift',
        operating_hours: [
          { day_of_week: 'Monday', open_time: '12:00:00', close_time: '15:00:00' },
          { day_of_week: 'Monday', open_time: '18:00:00', close_time: '22:00:00' },
        ],
      },
    }
    const user = userEvent.setup()
    await readLink(user, /your website/i, /your website/i, site)
    await screen.findByDisplayValue('Split Shift')

    expect(screen.getByText(/don’t fit one weekday and one weekend time/i)).toBeInTheDocument()
    expect(screen.queryByText(/Mon 12:00–15:00/)).not.toBeInTheDocument()
  })
})

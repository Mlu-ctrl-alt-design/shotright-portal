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
  // findAll: the submit-outcome alert also names the venue, and only one of
  // the matches lives in a table row.
  const cells = await screen.findAllByText(venueName)
  return cells.map((c) => c.closest('tr')).find(Boolean)
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

/* ============================================================================
   DRAFTS — the state that means "waiting on the partner", real on the bench
   since 23 Aug. Bucketing it under Pending (as this portal briefly did) told
   a partner "you're waiting on us" about a venue in no queue at all.
   ========================================================================= */
describe('draft venues', () => {
  const pushDraft = (overrides = {}) =>
    bench.venues.push({
      name: 'VEN-00042',
      venue_name: 'Umgababa Fish Shack',
      address: '1 Beach Rd, Umgababa',
      atmosphere_desc: 'Fresh off the boat',
      workflow_state: 'Draft',
      dress_code: 'Casual',
      moods: [],
      operating_hours: [],
      ...overrides,
    })

  it('shows under its own Drafts tab, badged Draft, with Submit leading the row', async () => {
    pushDraft()
    const { user } = renderApp({ route: LIST, signedIn: true })

    const row = await rowFor('Umgababa Fish Shack')
    expect(within(row).getByText('Draft')).toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'Submit Umgababa Fish Shack for review' }),
    ).toBeInTheDocument()
    // Edit is not lost — it waits in the overflow.
    expect(screen.queryByRole('link', { name: 'Edit Umgababa Fish Shack' })).toBeNull()
    await user.click(
      screen.getByRole('button', { name: 'More actions for Umgababa Fish Shack' }),
    )
    expect(screen.getByRole('link', { name: 'Edit Umgababa Fish Shack' })).toBeInTheDocument()
    // And the tab knows its own.
    expect(screen.getByRole('link', { name: /Drafts/ })).toHaveTextContent('1')
  })

  it('Submit moves a complete draft into the review queue, visibly', async () => {
    pushDraft()
    bench.photos['VEN-00042'] = [{ file: 'FILE-9', file_url: '/files/shack.jpg', idx: 1 }]
    const { user } = renderApp({ route: LIST, signedIn: true })

    const row = await rowFor('Umgababa Fish Shack')
    await user.click(
      within(row).getByRole('button', { name: 'Submit Umgababa Fish Shack for review' }),
    )

    await screen.findByText(/is with our team for review/i)
    expect(bench.venues.find((v) => v.name === 'VEN-00042').workflow_state).toBe('Pending')
    // The refetched list agrees: the row is badged Pending now.
    const after = await rowFor('Umgababa Fish Shack')
    await waitFor(() => expect(within(after).getByText('Pending')).toBeInTheDocument())
  })

  it('a refused Submit says every reason and where to fix them', async () => {
    pushDraft({ address: '', atmosphere_desc: '' }) // and no photos
    const { user } = renderApp({ route: LIST, signedIn: true })

    const row = await rowFor('Umgababa Fish Shack')
    await user.click(
      within(row).getByRole('button', { name: 'Submit Umgababa Fish Shack for review' }),
    )

    await screen.findByText(/isn’t ready for review yet/i)
    expect(screen.getByText(/at least one photograph/i)).toBeInTheDocument()
    expect(screen.getByText(/street address/i)).toBeInTheDocument()
    expect(screen.getByText(/describe the venue/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /finish the listing/i })).toBeInTheDocument()
  })
})

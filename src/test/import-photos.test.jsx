import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from './render'
import { bench } from './bench'
import { fillPage, saveAndAddPhotos } from './addVenue'

/**
 * Photos a partner already has on their own website or page (shotright #64).
 *
 * The importer hands back image URLs as SUGGESTIONS. Nothing is downloaded
 * until the partner ticks the ones to use AND confirms they are theirs to use:
 * a photo on a web page belongs to whoever took it, and only the partner can
 * say that was them. Google's photos are never offered — its terms forbid
 * keeping them — so a Google import brings no suggestions at all.
 */

const SITE = 'https://nomsa.co.za'
const BAR = 'https://nomsa.co.za/img/fire.jpg'
const TERRACE = 'https://nomsa.co.za/img/terrace.jpg'

const asPro = () => {
  bench.deploy.import_venue_from_url = true
  bench.deploy.get_entitlements = true
  bench.entitlements = { plan: 'pro', features: ['venue_import_google', 'venue_import_social', 'venue_import_website', 'venue_bulk_import'] }
}

async function importFromWebsite(user) {
  bench.importedByUrl = {
    [SITE]: { name: 'Nomsa’s Shisanyama', phone: '+27 82 111 2222', photo_suggestions: [BAR, TERRACE] },
  }
  renderApp({ route: '/venues/new', signedIn: true })
  await user.click(await screen.findByRole('tab', { name: /your website/i }))
  await user.type(screen.getByLabelText(/your website/i), SITE)
  await user.click(screen.getByRole('button', { name: /read it/i }))
  await screen.findByDisplayValue('Nomsa’s Shisanyama')
}

describe('photos from the partner’s own site', () => {
  it('are offered on the photos step, and added only once the partner says they are theirs', async () => {
    asPro()
    const user = userEvent.setup()
    await importFromWebsite(user)
    await fillPage(user)
    await saveAndAddPhotos(user)

    const offer = await screen.findByRole('group', { name: /photos from your page/i })
    expect(within(offer).getAllByRole('checkbox', { name: /use this photo/i })).toHaveLength(2)
    const add = within(offer).getByRole('button', { name: /add 2 photos/i })
    expect(add).toBeDisabled()

    await user.click(within(offer).getByRole('checkbox', { name: /these photos are mine/i }))
    await user.click(add)

    await waitFor(() => expect(screen.getByText(/2 of 10/i)).toBeInTheDocument())
    const call = bench.calls.find((c) => c.method === 'save_imported_photos')
    expect(call.args).toEqual({ urls: [BAR, TERRACE], confirm_rights: 1 })
    expect(screen.queryByRole('group', { name: /photos from your page/i })).not.toBeInTheDocument()
  })

  it('adds only the ones left ticked', async () => {
    asPro()
    const user = userEvent.setup()
    await importFromWebsite(user)
    await fillPage(user)
    await saveAndAddPhotos(user)

    const offer = await screen.findByRole('group', { name: /photos from your page/i })
    await user.click(within(offer).getAllByRole('checkbox', { name: /use this photo/i })[1])
    await user.click(within(offer).getByRole('checkbox', { name: /these photos are mine/i }))
    await user.click(within(offer).getByRole('button', { name: /add 1 photo$/i }))

    await waitFor(() => expect(screen.getByText(/1 of 10/i)).toBeInTheDocument())
    expect(bench.calls.find((c) => c.method === 'save_imported_photos').args.urls).toEqual([BAR])
  })

  it('offers nothing when the import found no images', async () => {
    asPro()
    const user = userEvent.setup()
    bench.importedByUrl = { [SITE]: { name: 'Nomsa’s Shisanyama' } }
    renderApp({ route: '/venues/new', signedIn: true })
    await user.click(await screen.findByRole('tab', { name: /your website/i }))
    await user.type(screen.getByLabelText(/your website/i), SITE)
    await user.click(screen.getByRole('button', { name: /read it/i }))
    await screen.findByDisplayValue('Nomsa’s Shisanyama')
    await fillPage(user)
    await saveAndAddPhotos(user)

    await screen.findByText(/now the photos/i)
    expect(screen.queryByRole('group', { name: /photos from your page/i })).not.toBeInTheDocument()
  })
})

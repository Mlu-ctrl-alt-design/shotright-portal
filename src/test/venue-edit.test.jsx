import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderApp } from './render'
import { bench, venueById } from './bench'

/**
 * Editing an existing venue.
 *
 * Every assertion reads the SERVER after the save. That is the whole point:
 * "the name doesn't persist" was reported from production, and the cause was a
 * 200 that stored nothing. A test that checks the form still shows what was
 * typed would have passed happily through it.
 */

const EDIT = '/venues/VEN-00001/edit'

const save = async (user) =>
  user.click(await screen.findByRole('button', { name: /save and resubmit|^save/i }))

describe('edit a venue', () => {
  it('loads the venue’s current values into the form', async () => {
    renderApp({ route: EDIT, signedIn: true })

    expect(await screen.findByRole('textbox', { name: /venue name/i })).toHaveValue(
      'Corner Kitchen & Bar',
    )
  })

  it('saves an ordinary change to the server', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    /* On the EDIT form these are plain text inputs, not the selects the wizard
       uses. Same fields, different controls — one more reason to query what is
       actually rendered rather than what a spec says should be. */
    const dress = await screen.findByLabelText(/dress code/i)
    await user.clear(dress)
    await user.type(dress, 'Formal')
    await save(user)

    await waitFor(() => expect(venueById('VEN-00001').dress_code).toBe('Formal'))

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'update_venue')).toBe(true))
  })

  it('renames the venue, and the new name is what the server holds', async () => {
    /* REPORTED FROM PRODUCTION: "when editing a venue the name does not
       persist". The identifier and the new name were the same parameter, so
       the rename overwrote the thing that said WHICH venue to rename. */
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const field = await screen.findByRole('textbox', { name: /venue name/i })
    await user.clear(field)
    await user.type(field, 'Corner Kitchen and Bar')
    await save(user)

    await waitFor(() =>
      expect(venueById('VEN-00001').venue_name).toBe('Corner Kitchen and Bar'),
    )
  })

  it('never sends the identifier as the new name', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const field = await screen.findByRole('textbox', { name: /venue name/i })
    await user.clear(field)
    await user.type(field, 'Corner Kitchen and Bar')
    await save(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'update_venue')).toBe(true))
    const call = bench.calls.find((c) => c.method === 'update_venue')
    // Whatever the rename parameter ends up being called, the venue_name that
    // IDENTIFIES the row must still be the docname.
    expect(call.args.venue_name).toBe('VEN-00001')
  })

  it('never sends the approval state back up', async () => {
    /* The form loads the whole venue. Spreading it back on save posted
       `workflow_state`, letting a client set its own approval. */
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await screen.findByRole('textbox', { name: /venue name/i })
    await save(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'update_venue')).toBe(true))
    expect(bench.calls.find((c) => c.method === 'update_venue').args).not.toHaveProperty(
      'workflow_state',
    )
  })

  it('tells the partner when the server refused part of the save', async () => {
    /* Production: `Cannot update field(s): address, cmd, new_name,
       new_venue_name`. `update_venue` validates rather than ignoring, so one
       unknown key used to take the whole edit down with it. */
    bench.venueWritable = bench.venueWritable.filter((f) => f !== 'address')
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const address = await screen.findByLabelText(/^address$/i)
    await user.clear(address)
    await user.type(address, '99 Bree St, Cape Town')
    await save(user)

    // Named in words a partner uses, and the rest of the edit still went.
    expect(await screen.findByText(/couldn’t update the address/i)).toBeInTheDocument()
  })

  it('does not show Frappe’s internals when a save is refused', async () => {
    bench.venueWritable = bench.venueWritable.filter((f) => f !== 'address')
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const address = await screen.findByLabelText(/^address$/i)
    await user.clear(address)
    await user.type(address, '99 Bree St')
    await save(user)

    await screen.findByText(/couldn’t update/i)
    const body = document.body.textContent
    expect(body).not.toMatch(/\bcmd\b|new_venue_name|Traceback|ValidationError/)
  })

  it('says something honest when the venue cannot be loaded', async () => {
    bench.deploy.get_venue_detail = false
    bench.deploy.get_vendor_dashboard = false
    renderApp({ route: EDIT, signedIn: true })

    await waitFor(
      () => expect(document.body.textContent).not.toMatch(/Loading venue/i),
      { timeout: 5000 },
    )
    expect(document.body.textContent).not.toMatch(/DoesNotExistError|Traceback/)
  })

  it('recovers the venue from the list when the detail endpoint 404s', async () => {
    /* Production: get_venue_detail 404'd for a venue get_vendor_dashboard had
       just listed, and the partner was told it wasn't on their account. */
    bench.deploy.get_venue_detail = false
    renderApp({ route: EDIT, signedIn: true })

    expect(
      await screen.findByRole('textbox', { name: /venue name/i }, { timeout: 5000 }),
    ).toHaveValue('Corner Kitchen & Bar')
  })
})

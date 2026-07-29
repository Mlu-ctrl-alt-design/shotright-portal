import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'

/**
 * Resuming a half-finished setup, and putting photographs on a venue.
 *
 * Both are about work surviving. A partner fills in three steps on their phone
 * behind a bar, gets interrupted, and comes back an hour later; and a partner
 * uploads six photographs and expects to find six photographs. Neither is
 * something they will report politely if it fails — they will just stop using
 * the portal.
 */

const draft = (over = {}) => ({
  draft_id: 'DRAFT-1',
  name: 'DRAFT-1',
  venue_name: 'Half-finished Bistro',
  step: 1,
  completed: 0,
  modified: '2026-07-28 09:00:00',
  payload: JSON.stringify({
    details: {
      venue_name: 'Half-finished Bistro',
      manager_name: 'Nomsa',
      manager_surname: 'Dlamini',
      contact_number: '+27 82 111 2222',
      address: '4th Ave, Mamelodi',
      latitude: -25.7069,
      longitude: 28.2294,
      dress_code: 'Casual',
      atmosphere_desc: '',
    },
    // `moods` is an OBJECT wrapping the list, not the list itself — the wizard
    // spreads it over `{ moods: [] }`. An array here spreads to numeric keys
    // and silently restores nothing, which is exactly how this fixture was
    // wrong the first time.
    moods: { moods: [{ status: 'canonical', mood: 'MOOD-CHILLED', label: 'Chilled' }] },
  }),
  ...over,
})

describe('resume a venue addition', () => {
  it('offers to pick up where they left off', async () => {
    bench.drafts.push(draft())
    renderApp({ route: '/', signedIn: true })

    expect(await screen.findByText(/pick up where you left off/i)).toBeInTheDocument()
  })

  it('names the venue the draft is for', async () => {
    /* "You have an unfinished setup" is useless to someone with three venues.
       The one thing that makes the card actionable is which one it is. */
    bench.drafts.push(draft())
    renderApp({ route: '/', signedIn: true })

    await screen.findByText(/pick up where you left off/i)
    expect(screen.getByText(/Half-finished Bistro/)).toBeInTheDocument()
  })

  it('re-opens the wizard with the saved answers still in it', async () => {
    bench.drafts.push(draft())
    const { user } = renderApp({ route: '/', signedIn: true })

    await user.click(await screen.findByRole('link', { name: /continue setup/i }))

    // Whichever step it lands on, the work is there — that is the promise the
    // card makes, and the only one worth testing.
    await waitFor(
      () => expect(document.body.textContent).toMatch(/Half-finished Bistro|Chilled/),
      { timeout: 5000 },
    )
  })

  it('offers nothing when there is no draft', async () => {
    renderApp({ route: '/', signedIn: true })

    await screen.findByRole('heading', { name: /welcome back/i })
    expect(screen.queryByText(/pick up where you left off/i)).not.toBeInTheDocument()
  })

  it('says so when the saved setup cannot be found, rather than opening a blank form', async () => {
    /* A partner who followed a link promising their work back is entitled to
       know it is not coming, instead of being dropped on an empty wizard and
       left to conclude they imagined it. */
    renderApp({ route: '/venues/new?draft=DRAFT-GONE', signedIn: true })

    expect(
      await screen.findByText(/couldn’t find that saved setup/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  })

  it('saves progress as the partner works, without being asked', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await user.type(await screen.findByRole('textbox', { name: /^mood$/i }), 'Chilled')
    await user.click(screen.getByRole('button', { name: /add \+|^add$/i }))

    await waitFor(() => expect(bench.drafts.length).toBeGreaterThan(0), { timeout: 6000 })
  })

  it('does not claim to have saved when the draft endpoint is missing', async () => {
    /* "Saved" is a promise about someone else's machine. If the write did not
       happen, saying it did is how a partner closes the tab on an hour's work. */
    bench.deploy.save_venue_draft = false
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await user.type(await screen.findByRole('textbox', { name: /^mood$/i }), 'Chilled')
    await user.click(screen.getByRole('button', { name: /add \+|^add$/i }))
    await new Promise((r) => setTimeout(r, 1500))

    expect(document.body.textContent).not.toMatch(/\bSaved\b/)
  })
})

describe('upload venue images', () => {
  const EDIT = '/venues/VEN-00001/edit'
  const file = (name = 'front-bar.jpg') =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

  const photoInput = async () => {
    await screen.findByRole('heading', { name: /photos of this venue/i })
    return document
      .querySelector('section[aria-labelledby="venue-photos-heading"]')
      .querySelector('input[type="file"]')
  }

  it('uploads a chosen photo and shows it', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.upload(await photoInput(), file())

    expect(await screen.findByAltText('front-bar.jpg')).toBeInTheDocument()
    await waitFor(() => expect(bench.files).toHaveLength(1))
  })

  it('attaches it to the venue, so a moderator can see it', async () => {
    /* An uploaded File that is attached to nothing is invisible to the person
       reviewing the venue — the partner sees success, the reviewer sees an
       empty listing, and neither is placed to notice. */
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.upload(await photoInput(), file())

    await waitFor(() => expect(bench.files).toHaveLength(1))
    expect(bench.files[0].attached_to_name).toBe('VEN-00001')
  })

  it('keeps the partner’s own filename', async () => {
    /* We may transcode a .png to .jpg on the way up. Showing them a name they
       never typed is a small mystery with no upside. */
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.upload(await photoInput(), file('braai-area.png'))

    expect(await screen.findByAltText('braai-area.png')).toBeInTheDocument()
  })

  it('saves the photos with the venue', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.upload(await photoInput(), file())
    await screen.findByAltText('front-bar.jpg')
    await user.click(screen.getByRole('button', { name: /save and resubmit|^save/i }))

    await waitFor(() => expect(bench.photos['VEN-00001']?.length).toBe(1))
  })

  it('marks the first photo as the one customers see', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.upload(await photoInput(), file())
    await screen.findByAltText('front-bar.jpg')

    const section = document.querySelector('section[aria-labelledby="venue-photos-heading"]')
    expect(within(section).getByText(/customers see this one first/i)).toBeInTheDocument()
  })

  it('shows photos the venue already has', async () => {
    bench.photos['VEN-00001'] = [
      { name: 'F1', file_url: '/files/old.jpg', file_name: 'old.jpg' },
    ]
    renderApp({ route: EDIT, signedIn: true })

    expect(await screen.findByAltText('old.jpg')).toBeInTheDocument()
  })

  it('does not render an empty box when it simply could not read them', async () => {
    /* REPORTED: "the images uploaded seem to not persist". A refused File
       listing returned the same empty array as a venue with no photos, so six
       photographs looked deleted. */
    bench.deploy.get_venue_photos = false
    bench.deploy['frappe.client.get_list'] = false
    renderApp({ route: EDIT, signedIn: true })

    await screen.findByRole('heading', { name: /photos of this venue/i })
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/can’t show you the photos already on this venue/i),
    )
    expect(document.body.textContent).toMatch(/aren’t lost/i)
  })

  it('does not say that about a venue that genuinely has none', async () => {
    renderApp({ route: EDIT, signedIn: true })

    await screen.findByRole('heading', { name: /photos of this venue/i })
    await new Promise((r) => setTimeout(r, 500))
    expect(document.body.textContent).not.toMatch(/can’t show you the photos already/i)
  })

  it('reports an upload that failed, rather than showing a tile for it', async () => {
    bench.deploy.upload_file = false
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.upload(await photoInput(), file())

    await waitFor(() => expect(document.body.textContent).toMatch(/didn’t upload|couldn’t/i))
    expect(screen.queryByAltText('front-bar.jpg')).not.toBeInTheDocument()
  })
})

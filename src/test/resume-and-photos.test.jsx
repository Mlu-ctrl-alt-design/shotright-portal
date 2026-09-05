import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
      await screen.findByText(/couldn’t find that draft/i, {}, { timeout: 5000 }),
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

  it('says a photo it cannot load is not lost, rather than drawing a broken icon', async () => {
    /* REPORTED 28 Jul: "the uploaded pictures are showing as broken links."

       An <img> is a plain browser GET carrying no Authorization header — our
       token only rides on axios calls — so a private file, or a host not
       forwarding /files, renders as the browser's torn-paper glyph. The photo
       is not gone: it uploaded, and it is attached to the venue. What failed is
       showing it back, and a partner deserves to be told which. */
    bench.photos['VEN-00001'] = [
      { name: 'F1', file_url: '/files/unreachable.jpg', file_name: 'unreachable.jpg' },
    ]
    renderApp({ route: EDIT, signedIn: true })

    const img = await screen.findByAltText('unreachable.jpg')
    fireEvent.error(img)

    expect(await screen.findByText(/can’t show this one/i)).toBeInTheDocument()
    expect(screen.getByText(/it uploaded and it’s on the venue/i)).toBeInTheDocument()
  })

  it('reports an upload that failed, rather than showing a tile for it', async () => {
    /* The EDIT form uploads through `upload_venue_photo` as of 22 Aug — the
       whitelisted method that elevates. `upload_file` is only used by the
       wizard, where no venue exists yet to attach to, so switching that off
       here would prove nothing. */
    bench.deploy.upload_venue_photo = false
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.upload(await photoInput(), file())

    await waitFor(() => expect(document.body.textContent).toMatch(/didn’t upload|couldn’t/i))
    expect(screen.queryByAltText('front-bar.jpg')).not.toBeInTheDocument()
  })
})

/* ============================================================================
   REPORTED 8 AUG — "on the dashboard 'discard this draft' button is not working"

   Two ways for it to be dead, both silent, and the fake bench can now produce
   each one. The point of these is less the fix than the SAYING: a control that
   does nothing and reports nothing is indistinguishable from a slow one, so a
   partner presses it again and concludes the portal ignores them.
   ========================================================================= */
describe('discarding a draft', () => {
  const seedDraft = () => {
    bench.drafts.push({
      draft_id: 'DRAFT-1',
      name: 'DRAFT-1',
      venue_name: 'Half-finished venue',
      step: 1,
      completed: 0,
      payload: JSON.stringify({ details: { venue_name: 'Half-finished venue' } }),
      modified: '2026-08-07 10:00:00',
    })
  }

  it('discards it, and the card goes', async () => {
    seedDraft()
    const { user } = renderApp({ route: '/', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /discard this draft/i }))

    await waitFor(() => expect(bench.drafts).toHaveLength(0))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /discard this draft/i })).not.toBeInTheDocument(),
    )
  })

  it('works when the listing names the draft `name`, not `draft_id`', async () => {
    /* THE REPORTED BUG. `frappe.get_all` returns the docname as `name` and
       nothing called `draft_id` unless someone aliased it. The id came back
       undefined, `discardDraft` bailed on its own `if (!id)` guard, and the
       button did nothing whatsoever. */
    bench.draftIdField = 'name'
    seedDraft()
    const { user } = renderApp({ route: '/', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /discard this draft/i }))

    await waitFor(() => expect(bench.drafts).toHaveLength(0))
  })

  it('says so when the server takes the call and deletes nothing', async () => {
    /* The house speciality: an undeclared kwarg is dropped at 200, so the call
       "succeeds", the list refetches, and the card is still sitting there. */
    bench.draftDiscardSilentlyFails = true
    seedDraft()
    const { user } = renderApp({ route: '/', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /discard this draft/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t discard this draft/i)
    expect(screen.getByText(/still here and nothing has been lost/i)).toBeInTheDocument()
    /* And the card stays, which is the truth — the draft is still there. */
    expect(screen.getByRole('button', { name: /discard this draft/i })).toBeInTheDocument()
  })

  it('never claims a deletion the listing still shows', async () => {
    bench.draftDiscardSilentlyFails = true
    seedDraft()
    const { user } = renderApp({ route: '/', signedIn: true })

    await user.click(await screen.findByRole('button', { name: /discard this draft/i }))
    await screen.findByRole('alert')

    expect(bench.drafts).toHaveLength(1)
    expect(screen.getByText(/Half-finished venue/i)).toBeInTheDocument()
  })
})

/* ============================================================================
   VERIFIED ON THE BENCH, 22 AUG — the endpoint switch

   `upload_file` with `doctype=Venue` is a PERMANENT 403. Vendors hold
   ["All","Guest"]; Venue grants write to System Manager / Venue Reviewer only.
   There is no attach grant and there must never be one — Frappe role
   permissions are not row-scoped, so granting it would let every partner write
   every other partner's venue.

   `shotright.api.upload_venue_photo` elevates internally and is the fix. These
   pin the switch, because the failure mode of getting it wrong is silent: a
   photo that uploads, shows a tile, and attaches to nothing.
   ========================================================================= */
/* Same helpers as the suite above, which scopes them inside its own describe. */
const EDIT = '/venues/VEN-00001/edit'
const jpeg = (name = 'front-bar.jpg') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

const uploaderInput = async () => {
  await screen.findByRole('heading', { name: /photos of this venue/i })
  return document
    .querySelector('section[aria-labelledby="venue-photos-heading"]')
    .querySelector('input[type="file"]')
}

describe('uploading through the whitelisted method', () => {
  it('uses upload_venue_photo when the venue exists', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })
    await user.upload(await uploaderInput(), jpeg())

    await waitFor(() =>
      expect(bench.calls.some((c) => c.method === 'upload_venue_photo')).toBe(true),
    )
    const call = bench.calls.find((c) => c.method === 'upload_venue_photo')
    expect(call.args.venue_name).toBe('VEN-00001')
  })

  it('NEVER sends doctype=Venue — it is a permanent 403, not a gap', async () => {
    /* The bench refuses this unconditionally now, so a regression fails here
       rather than for every partner in production. */
    const { user } = renderApp({ route: EDIT, signedIn: true })
    await user.upload(await uploaderInput(), jpeg())

    await waitFor(() => expect(bench.files.length).toBeGreaterThan(0))
    const attempted = bench.calls.filter((c) => c.method === 'upload_file')
    expect(attempted.every((c) => c.args.doctype !== 'Venue')).toBe(true)
  })

  it('attaches to the venue, so a reviewer sees it', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })
    await user.upload(await uploaderInput(), jpeg())

    await waitFor(() => expect(bench.files.length).toBeGreaterThan(0))
    expect(bench.files.at(-1).attached_to_name).toBe('VEN-00001')
  })

  it('saves the uploaded photo WITH its File docname', async () => {
    /* ⚠️ 23 Aug, from the live site: `upload_venue_photo` returns the File
       docname as `file` — core `upload_file` calls it `name` — and the client
       read only `name`. So every photo uploaded through the attaching path
       reached `set_venue_photos` as `file: undefined`, and the whole save came
       back 417: "Each photo needs a `file` (the File docname)". The fake bench
       now refuses exactly what the real one refuses, so this test fails at the
       save (an alert, no stored rows) rather than passing over the drift. */
    const { user } = renderApp({ route: EDIT, signedIn: true })
    await user.upload(await uploaderInput(), jpeg())
    await waitFor(() => expect(bench.files.length).toBeGreaterThan(0))

    await user.click(await screen.findByRole('button', { name: /save and resubmit|^save/i }))

    await waitFor(() => expect(bench.photos['VEN-00001']?.length).toBeGreaterThan(0))
    const rows = bench.photos['VEN-00001']
    expect(rows.every((r) => typeof r.file === 'string' && r.file.length > 0)).toBe(true)
    expect(rows.at(-1).file).toBe(bench.files.at(-1).name)
  })
})

/* ============================================================================
   A FORMAT THE SERVER WILL NOT TAKE — covered in verify11, not here.

   Verified 22 Aug: .heic and .avif come back 417 and terminal. Testing it needs
   a file the browser's `accept` filter would reject, and `user.upload` honours
   that attribute — so the file never reaches the code under test and the
   assertion passes or fails for the wrong reason. Playwright's `setInputFiles`
   does not honour it, which is why the test lives in the browser suite.

   Worth naming rather than deleting: this is the one path where a partner can
   be holding a photo, on a now-REQUIRED field, and be unable to use it.
   ========================================================================= */

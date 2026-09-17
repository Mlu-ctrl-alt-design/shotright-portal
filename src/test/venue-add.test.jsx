import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderApp } from './render'
import { bench } from './bench'
import {
  NAME,
  addPhoto,
  completeVenue,
  fillPage,
  pickMood,
  saveAndAddPhotos,
  sendForReview,
  setLocation,
  skipImport,
  walkToReview,
} from './addVenue'

/**
 * Adding a venue — import, one page, photos.
 *
 * ⚠️ REWRITTEN 17 Sep. This suite used to walk five steps and press Next four
 * times. The flow it drove is gone; what it was PROTECTING is not, and every
 * assertion below is the same claim made against the new shape:
 *
 *   - a venue reaches the server with what was typed into it
 *   - the client never chooses its own approval state
 *   - a venue with no name, no pin or no mood does not get through
 *   - work is not lost when something fails
 *
 * Everything here is typed, clicked and uploaded. The assertions that matter
 * are about what reached the SERVER — `bench.venues` after the fact — because a
 * form that collects a whole venue and posts three quarters of it is exactly
 * the bug a render test cannot see.
 *
 * THREE THINGS THIS SUITE LEARNED BY DRIVING THE REAL UI:
 *
 *  1. The first screen is IMPORT, not the form, whenever the bench can serve a
 *     route — and the default fake bench deploys `search_places`, so it does.
 *  2. The form will not be left without a location. A venue with no pin is
 *     found by nobody, so every walk that wants to finish has to set one.
 *  3. Moods are CHIPS off the canonical list now, not a text field. A mood the
 *     bench does not have cannot be typed in, which is the point.
 */

describe('add a venue', () => {
  it('walks the whole flow and creates the venue on the server', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await completeVenue(user)

    await waitFor(() => expect(bench.venues.some((v) => v.venue_name === name)).toBe(true))
  })

  it('never lets the client choose the approval state', async () => {
    /* `workflow_state` is the server's. The edit form once spread the whole
       venue back up on save, which sent it — a client that can approve its own
       venue is the one real security hole on this API surface. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await completeVenue(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    expect(bench.calls.find((c) => c.method === 'create_venue').args).not.toHaveProperty(
      'workflow_state',
    )
    expect(bench.venues.find((v) => v.venue_name === NAME).workflow_state).toBe('Pending')
  })

  it('says plainly that the manager and phone number had nowhere to go', async () => {
    /* ⚠️ THE FORM REQUIRES BOTH AND THE BACKEND STORES NEITHER.
       `create_venue` declares no field for a manager or a contact number, so
       they are dropped — and the redesign made both REQUIRED, which makes
       saying so more important rather than less. A form that demands a phone
       number and silently bins it is the worst of both. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await completeVenue(user)

    expect(
      await screen.findByText(/manager details and contact number were not saved/i),
    ).toBeInTheDocument()
  })

  it('will not save without a venue name', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await setLocation(user)
    await pickMood(user)
    await saveAndAddPhotos(user)

    // Still on the form, and told why rather than silently refusing to move.
    expect(screen.getByRole('textbox', { name: /venue name/i })).toBeInTheDocument()
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
  })

  it('will not submit a venue with no location', async () => {
    /* A venue with no coordinates is never returned by a search, whatever else
       is on it. Being stopped here beats being approved and invisible. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await fillPage(user, { coords: false })
    await saveAndAddPhotos(user)

    expect(screen.getByRole('textbox', { name: /venue name/i })).toBeInTheDocument()
    expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(false)
  })

  it('will not submit a venue with no description', async () => {
    /* ⚠️ THIS IS THE BACKEND'S RULE, NOT OURS. `submit_venue_for_review`
       refuses a venue with an empty description outright. The old wizard
       satisfied it by accident through an atmosphere dropdown; the redesign
       replaced that with mood chips, so without this the default path finishes
       a whole venue and is then declined for a field the form called optional. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await fillPage(user, { words: false })
    await saveAndAddPhotos(user)

    expect(screen.getByRole('textbox', { name: /venue name/i })).toBeInTheDocument()
    expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(false)
  })

  it('will not submit a venue with no mood', async () => {
    /* Sho't Right finds venues BY MOOD. One with none cannot be found by
       anybody, so it is not a listing, it is a row in a table. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await fillPage(user, { mood: false })
    await saveAndAddPhotos(user)

    expect(screen.getByRole('textbox', { name: /venue name/i })).toBeInTheDocument()
    expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(false)
  })

  it('keeps what was typed when going back from the photos', async () => {
    /* Losing the form on Back is the bug nobody reports — they just start
       again, and then they don't. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await walkToReview(user, { photo: false })
    await user.click(screen.getByRole('button', { name: /back to details/i }))

    expect(await screen.findByRole('textbox', { name: /venue name/i })).toHaveValue(name)
    expect(screen.getByRole('textbox', { name: /^manager$/i })).toHaveValue('Nomsa Dlamini')
  })

  it('sends the moods the partner actually chose', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await completeVenue(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    expect(bench.venues.find((v) => v.venue_name === NAME).moods.length).toBeGreaterThan(0)
  })

  it('shows the new venue in the list afterwards', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await completeVenue(user)

    // The point of the whole flow: it is there when they go looking.
    expect(await screen.findByText(name, {}, { timeout: 6000 })).toBeInTheDocument()
  })

  it('does not lose the partner’s work when create_venue fails', async () => {
    bench.deploy.create_venue = false
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await completeVenue(user)

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    // Their venue's name is still on screen — no silent reset to an empty form.
    expect(
      screen.getByText(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
    ).toBeInTheDocument()
  })
})

describe('set a venue location', () => {
  it('sends the coordinates that were entered', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await completeVenue(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    const created = bench.venues.find((v) => v.venue_name === NAME)
    expect(Number(created.latitude)).toBeCloseTo(-25.7069, 3)
    expect(Number(created.longitude)).toBeCloseTo(28.2294, 3)
  })

  it('sends them as numbers, not strings', async () => {
    /* They come off an input as strings. A venue whose latitude is "-25.7"
       cannot be compared against a radius, so it is found by nobody — and
       nothing in the UI would ever show that. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await completeVenue(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    const call = bench.calls.find((c) => c.method === 'create_venue')
    expect(typeof call.args.latitude).toBe('number')
    expect(typeof call.args.longitude).toBe('number')
  })

  it('keeps the pin when the partner goes to the photos and back', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user, { photo: false })
    await user.click(screen.getByRole('button', { name: /back to details/i }))

    /* What is being protected is unchanged: moving between screens must not
       quietly drop the one value that decides whether customers find this
       venue. */
    await waitFor(() => {
      const node = document.querySelector('[data-field="latitude"]')
      expect(node?.getAttribute('data-latitude')).toBe('-25.7069')
    })
  })

  it('keeps the map out of the way until somebody asks for it', async () => {
    /* The map was the tallest thing on the old step and most partners never
       touched it. Collapsed to a confirm row is most of why this page fits. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)

    expect(screen.queryByRole('combobox', { name: /^address/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add address/i }))
    expect(await screen.findByRole('combobox', { name: /^address/i })).toBeInTheDocument()
  })

  it('opens the map by itself when the thing it is blocking on is in there', async () => {
    /* Scrolling somebody to a collapsed row and telling them to fix a field
       they cannot see is worse than not scrolling at all. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await fillPage(user, { coords: false })
    await saveAndAddPhotos(user)

    expect(await screen.findByRole('combobox', { name: /^address/i })).toBeInTheDocument()
  })
})

/* ============================================================================
   PHOTOS ARE REQUIRED — and the condition on that is the point

   Asked for 13 Aug: "we cannot have a venue that does not have images of any
   nature." Agreed, and a venue with no picture competes badly in a product
   people choose with their eyes.

   But the uploader was returning 403 in production on the day this was asked,
   and an unconditional requirement on a broken uploader does not produce
   venues with photos — it produces NO VENUES AT ALL, because the flow refuses
   to submit and the partner has no way to make it submit. So the rule is
   enforced only where it can be satisfied, which is the same rule the legal
   gate follows.

   ⚠️ IT IS ENFORCED ON THE PHOTO SCREEN NOW, not inside the form. Photographs
   moved out on 17 Sep — better taken standing in the room than remembered at a
   desk — so the gate moved with them.
   ========================================================================= */
describe('at least one photo', () => {
  it('will not send for review without one', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user, { photo: false })
    await sendForReview(user)

    expect((await screen.findAllByText(/add at least one photo/i)).length).toBeGreaterThan(0)
    expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(false)
  })

  it('says why, in terms of what it costs the partner', async () => {
    /* "This field is required" tells someone the form has a rule. Telling them
       a venue with no pictures rarely gets picked tells them why they should
       want to. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user, { photo: false })
    await sendForReview(user)

    expect(
      (await screen.findAllByText(/people choose where to go by looking/i)).length,
    ).toBeGreaterThan(0)
  })

  it('marks the uploader required BEFORE anyone is blocked', async () => {
    /* A rule you only discover by hitting it is indistinguishable from a bug. */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user, { photo: false })

    const heading = await screen.findByRole('heading', { name: /venue photos/i })
    expect(heading).toHaveTextContent(/required/i)
  })

  it('lets the venue through once a photo is added', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await completeVenue(user)

    await waitFor(() => expect(bench.venues.some((v) => v.venue_name === name)).toBe(true))
  })

  it('does NOT require one when the bench refuses uploads', async () => {
    /* THE ASSERTION THIS WHOLE RULE HANGS ON.

       On 13 Aug `upload_file` was returning 403 for every partner. Enforcing
       the requirement in that state would have stopped anybody listing a venue
       at all — turning "some venues look sparse" into "onboarding is down".
       A rule nobody can satisfy is not a stricter rule, it is an outage. */
    bench.uploadRefused = 'always'
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await walkToReview(user, { photo: false })

    /* The partner TRIES, and is refused. That refusal is the signal — the read
       probe cannot tell us this, because reading photos and uploading them are
       different permissions. */
    const file = new File(['png-bytes'], 'venue.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText(/venue photos — choose files/i), file)
    await screen.findByText(/the app isn’t allowed to/i)

    await sendForReview(user)

    // It went through — not trapped behind a control that cannot succeed.
    await waitFor(() => expect(bench.venues.some((v) => v.venue_name === name)).toBe(true))
  })

  it('does not mark the uploader required when uploads are refused', async () => {
    /* An asterisk beside a control that cannot succeed is a promise the page
       cannot keep. */
    bench.uploadRefused = 'always'
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user, { photo: false })

    const file = new File(['png-bytes'], 'venue.png', { type: 'image/png' })
    await user.upload(await screen.findByLabelText(/venue photos — choose files/i), file)
    await screen.findByText(/the app isn’t allowed to/i)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /venue photos/i })).not.toHaveTextContent(
        /required/i,
      ),
    )
  })
})

/* ============================================================================
   THE SUBMISSION STEP — creation stopped meaning submission on the bench
   (22 Aug gate, live 23 Aug). The flow calls submit_venue_for_review after
   everything is saved, and the success screen only claims "sent to our team"
   when that is what happened. These pin all three outcomes.
   ========================================================================= */
describe('submitting for review', () => {
  it('queues the finished venue and says so truthfully', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await completeVenue(user)

    await screen.findByText(/sent to our team for review/i)
    expect(bench.calls.find((c) => c.method === 'submit_venue_for_review')).toBeTruthy()
    expect(bench.venues.find((v) => v.venue_name === name).workflow_state).toBe('Pending')
  })

  it('shows every reason when the rules refuse the listing, and offers the way forward', async () => {
    /* Photos saved pre-venue can fail to attach (the endpoint may be behind);
       the completeness rules then refuse the listing. The partner must see ALL
       the reasons and where to go — never "sent for review" over a venue that
       is actually Declined. */
    bench.deploy.set_venue_photos = false
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await completeVenue(user)

    await screen.findByText(/not ready for review yet/i)
    expect(screen.getByText(/at least one photograph/i)).toBeInTheDocument()
    expect(screen.queryByText(/sent to our team for review/i)).toBeNull()
    expect(screen.getByRole('link', { name: /finish the listing/i })).toBeInTheDocument()
    expect(bench.venues.find((v) => v.venue_name === name).workflow_state).toBe('Declined')
  })

  it('never claims a review on a bench that cannot queue one', async () => {
    bench.deploy.submit_venue_for_review = false
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    const name = await completeVenue(user)

    await screen.findByText(/couldn’t send it to our team/i)
    expect(screen.queryByText(/sent to our team for review/i)).toBeNull()
    // The venue exists and is safe — in Draft, where My venues can submit it.
    expect(bench.venues.find((v) => v.venue_name === name).workflow_state).toBe('Draft')
  })
})

/* ============================================================================
   THE PROGRESS RAIL — the thing the redesign was actually for

   "Not knowing how much is left" was one of the four pain points behind this
   rewrite. The rail answers it, and it is only worth anything if it is honest:
   it must count FINISHED sections, never the one being worked on, and it must
   agree with the gate. A full bar over a blocked button is worse than no bar.
   ========================================================================= */
describe('the progress rail', () => {
  it('starts partly done, because the hours already have sensible defaults', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)

    expect((await screen.findAllByText(/1 of 6 done/i)).length).toBeGreaterThan(0)
  })

  it('ticks as each section is finished', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await fillPage(user)

    /* Five of six: basics, where, vibe, hours, description. Only the photos
       are outstanding, and they are deliberately NOT counted until one is
       actually uploaded — counting work nobody has done is the small lie that
       makes a progress bar worthless. */
    await waitFor(() =>
      expect(screen.getAllByText(/5 of 6 done/i).length).toBeGreaterThan(0),
    )
  })

  it('counts the photo once it is there', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await walkToReview(user)
    await user.click(screen.getByRole('button', { name: /back to details/i }))

    await waitFor(() =>
      expect(screen.getAllByText(/6 of 6 done/i).length).toBeGreaterThan(0),
    )
  })
})

/* ============================================================================
   THE GUIDED DESCRIPTION

   The blank rich-text box was the most abandoned control in the old wizard —
   it asked someone to be a copywriter at the end of a form. Three short
   questions get a usable paragraph out of people who would have left it empty,
   and they see what we made of their answers before it is saved.
   ========================================================================= */
describe('describing the venue', () => {
  it('assembles the answers into the paragraph and shows it back first', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await user.type(screen.getByLabelText(/known for\?/i), 'slow-cooked lamb')

    expect(await screen.findByText(/what customers will read/i)).toBeInTheDocument()
    expect(screen.getByText(/Known for slow-cooked lamb\./i)).toBeInTheDocument()
  })

  it('sends the assembled paragraph as the venue description', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await fillPage(user, { words: false })
    await user.type(screen.getByLabelText(/known for\?/i), 'slow-cooked lamb')
    await saveAndAddPhotos(user)
    await addPhoto(user)
    await sendForReview(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'create_venue')).toBe(true))
    expect(bench.calls.find((c) => c.method === 'create_venue').args.atmosphere_desc).toMatch(
      /Known for slow-cooked lamb\./i,
    )
  })

  it('does not repeat the phrase back when they answer in a full sentence', async () => {
    /* People answer "Known for?" with "we are known for our ribs". Pasting that
       in verbatim produces "Known for we are known for our ribs." */
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await user.type(screen.getByLabelText(/known for\?/i), 'we are known for our ribs')

    expect(await screen.findByText(/^Known for our ribs\.$/i)).toBeInTheDocument()
  })
})

/* ============================================================================
   SUGGESTING A VIBE WE DO NOT HAVE

   The design shows chips only, which is right for almost everybody — partners
   could not guess a vocabulary nobody had shown them. But the old mood step
   let someone type a vibe of their own and have it filed for review, and a
   venue whose whole character is a word we do not stock still has to be able
   to say so. Deleting a shipped feature because a prototype did not draw it is
   an accident, not a design decision — so it is kept, behind one line, closed.
   ========================================================================= */
describe('suggesting a vibe', () => {
  it('stays out of the way until somebody needs it', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)

    expect(screen.queryByRole('textbox', { name: /suggest a vibe/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nothing fits\? suggest a vibe/i })).toBeInTheDocument()
  })

  it('files a new one and puts it on the venue', async () => {
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await user.click(screen.getByRole('button', { name: /nothing fits\? suggest a vibe/i }))
    await user.type(await screen.findByRole('textbox', { name: /suggest a vibe/i }), 'Shisanyama')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    /* It has to be VISIBLE and removable. A vibe they added, cannot see and
       cannot take off again would still be sent at save. */
    const chip = await screen.findByRole('button', { name: /Shisanyama/i })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toHaveTextContent(/pending/i)
    expect(bench.calls.some((c) => c.method === 'resolve_mood')).toBe(true)
  })

  it('refuses one the bench could not file, rather than dropping it at save', async () => {
    /* `create_venue` rejects moods it does not know, so accepting an unmatched
       one here would fail the save later — after the partner had finished. */
    bench.deploy.resolve_mood = false
    const { user } = renderApp({ route: '/venues/new', signedIn: true })

    await skipImport(user)
    await user.click(screen.getByRole('button', { name: /nothing fits\? suggest a vibe/i }))
    await user.type(await screen.findByRole('textbox', { name: /suggest a vibe/i }), 'Masepa')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    expect(await screen.findByText(/doesn’t have “Masepa” yet/i)).toBeInTheDocument()
  })
})

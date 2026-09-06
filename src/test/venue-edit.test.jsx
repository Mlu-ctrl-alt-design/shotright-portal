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

  it('does not send fields the partner did not touch', async () => {
    /* PRODUCTION, 28 Jul: every venue edit 500'd with
       `TypeError: 'str' object does not support item assignment`. `moods` is a
       child table on Venue and `venue.update()` hands each row to Frappe's
       `_init_child`, which assigns into it — so a list of ids raises before
       anything saves.

       The form sends the whole venue back, so EVERY edit went through the one
       field the endpoint cannot accept. Changing a dress code should not carry
       the mood list at all. */
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const dress = await screen.findByLabelText(/dress code/i)
    await user.clear(dress)
    await user.type(dress, 'Formal')
    await save(user)

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'update_venue')).toBe(true))
    const call = bench.calls.find((c) => c.method === 'update_venue')
    expect(call.args).not.toHaveProperty('moods')
    expect(call.args).not.toHaveProperty('operating_hours')
    expect(call.args.dress_code).toBe('Formal')
    expect(venueById('VEN-00001').dress_code).toBe('Formal')
  })

  it('saves the rest of the edit when the mood list crashes the child table', async () => {
    /* The old bench, kept as a regression guard: the workaround must still
       work if a deployment ever goes back to it. */
    bench.moodsAreChildRows = true
    /* When moods genuinely change we have to send them, and on today's bench
       that raises. Nothing is saved — the exception is raised before the write
       — so the rest of the edit is still to do. */
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const dress = await screen.findByLabelText(/dress code/i)
    await user.clear(dress)
    await user.type(dress, 'Formal')
    // Add a second mood, so `moods` differs and has to be sent.
    await user.click(screen.getByRole('button', { name: /lively/i }))
    await save(user)

    // The dress code lands on the retry rather than being lost with the moods.
    await waitFor(() => expect(venueById('VEN-00001').dress_code).toBe('Formal'))
    expect(await screen.findByText(/couldn’t update the moods/i)).toBeInTheDocument()
  })

  it('never shows a raw Python TypeError to a partner', async () => {
    /* The old bench, kept as a regression guard: the workaround must still
       work if a deployment ever goes back to it. */
    bench.moodsAreChildRows = true
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await screen.findByLabelText(/dress code/i)
    await user.click(screen.getByRole('button', { name: /lively/i }))
    await save(user)

    await screen.findByText(/couldn’t update/i)
    expect(document.body.textContent).not.toMatch(/TypeError|item assignment|base_document|Traceback/)
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

  it('fills in an address the detail endpoint left out', async () => {
    /* REPORTED 28 Jul: "when I open a venue to edit it, the address does not
       show even though I know I set it."

       `get_venue_detail` and `get_vendor_dashboard` are different serialisers
       over the same doctype and do not return the same fields. The venue LIST
       shows each address, so we demonstrably have it — the form was asking the
       one endpoint that omits it and rendering the blank as though the partner
       had never typed one. Open, see empty, save, and it really is erased. */
    const stripped = { ...bench.venues[0] }
    delete stripped.address
    bench.venues[0] = stripped
    // The dashboard still carries it — restore it only on the list's copy.
    const withAddress = { ...stripped, address: '12 Long St, Cape Town' }
    bench.venues[0] = withAddress
    bench.detailOmits = ['address']

    renderApp({ route: EDIT, signedIn: true })

    expect(await screen.findByLabelText(/^address$/i, {}, { timeout: 5000 })).toHaveValue(
      '12 Long St, Cape Town',
    )
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

/* ============================================================================
   REPORTED 8 AUG — "unable to save because the moods are throwing an error"

   There was no server error. `moods` is a child table, so a read can hand it
   back as ids, as child rows, or as labels depending on which endpoint answered
   — and after a `get_venue_detail` 404 (§0, reported the same day for
   VEN-00008) it comes from the dashboard row, which is a different serialiser
   again. The form seeded straight from that and matched with
   `.includes(mood.name)`, so any shape but a flat list of docnames selected
   NOTHING, and the form's own "select at least one mood" rule then refused to
   submit a venue whose moods the partner had never touched.

   Being generous on the READ is safe and is what these cover. Being generous on
   the WRITE is not, and is deliberately not done: a guessed child-row shape
   makes Frappe write empty rows and report success, silently erasing a venue's
   moods. See §00.
   ========================================================================= */
describe('moods that arrive in an unexpected shape', () => {
  for (const shape of ['rows', 'labels']) {
    it(`shows the venue's moods as selected when they arrive as ${shape}`, async () => {
      bench.moodReadShape = shape
      renderApp({ route: EDIT, signedIn: true })

      /* Toggle pills, not checkboxes — `aria-pressed` carries the state. */
      const chilled = await screen.findByRole('button', { name: /^chilled$/i })
      expect(chilled).toHaveAttribute('aria-pressed', 'true')
    })

    it(`saves an ordinary edit when moods arrive as ${shape}`, async () => {
      /* THE REPORTED BUG. Nothing here touches a mood — this is someone fixing
         an address — and before the fix it could not be saved at all. */
      bench.moodReadShape = shape
      const { user } = renderApp({ route: EDIT, signedIn: true })

      const address = await screen.findByLabelText(/^address/i)
      await user.clear(address)
      await user.type(address, '9 Bree St, Cape Town')
      await user.click(screen.getByRole('button', { name: /save and resubmit|^save/i }))

      await waitFor(() =>
        expect(venueById('VEN-00001').address).toBe('9 Bree St, Cape Town'),
      )
      expect(screen.queryByText(/select at least one mood/i)).not.toBeInTheDocument()
    })
  }

  it('does not send moods when the selection has not changed', async () => {
    /* The other half of the fix, and the one that keeps ordinary edits away
       from §00 entirely: `moods` is the one field `update_venue` cannot take,
       so an edit to an address has no business carrying it. */
    bench.moodReadShape = 'rows'
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const address = await screen.findByLabelText(/^address/i)
    await user.clear(address)
    await user.type(address, '9 Bree St, Cape Town')
    await user.click(screen.getByRole('button', { name: /save and resubmit|^save/i }))

    await waitFor(() => expect(venueById('VEN-00001').address).toBe('9 Bree St, Cape Town'))
    const write = bench.calls.filter((c) => c.method === 'update_venue').at(-1)
    expect(write.args.moods).toBeUndefined()
  })

  it('treats re-ticking a mood as no change, rather than as an edit', async () => {
    /* Moods are a SET. Un-ticking one and putting it back used to reorder the
       array, which read as a change, which sent `moods`, which is the one field
       that crashes. A partner who changed their mind got a crash for it. */
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const lively = await screen.findByRole('button', { name: /^lively$/i })
    await user.click(lively)
    await user.click(lively)
    await user.click(screen.getByRole('button', { name: /save and resubmit|^save/i }))

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'update_venue')).toBe(true))
    const write = bench.calls.filter((c) => c.method === 'update_venue').at(-1)
    expect(write.args.moods).toBeUndefined()
  })

  it('still sends moods when the partner genuinely changes them', async () => {
    /* The fix must not become a way of never saving moods at all. */
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /^lively$/i }))
    await user.click(screen.getByRole('button', { name: /save and resubmit|^save/i }))

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'update_venue')).toBe(true))
    const write = bench.calls.filter((c) => c.method === 'update_venue').at(-1)
    expect(write.args.moods).toBeDefined()
  })

  it('keeps a mood it cannot resolve, rather than proposing to delete it', async () => {
    /* An unknown key is a mood we do not understand, not a mood the venue does
       not have. Dropping it on seed would quietly remove it on the next save. */
    bench.venues[0].moods = ['MOOD-CHILLED', 'MOOD-RETIRED']
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /^lively$/i }))
    await user.click(screen.getByRole('button', { name: /save and resubmit|^save/i }))

    await waitFor(() => expect(bench.calls.some((c) => c.method === 'update_venue')).toBe(true))
    const write = bench.calls.filter((c) => c.method === 'update_venue').at(-1)
    expect(write.args.moods).toContain('MOOD-RETIRED')
  })

  /**
   * REPORTED FROM THE LIVE SITE, via a console log:
   * `The specified value "9:00:" does not conform to the required format.`
   *
   * Two bugs behind one symptom, both from Frappe not zero-padding the hour of
   * a Time field. The form cut the first five characters off "9:00:00" and gave
   * an <input type="time"> a value it cannot parse, so the field rendered
   * EMPTY; and it compared open and close as strings, where "9:00:00" sorts
   * after "23:00:00", so the save was refused outright with "closing time must
   * be after opening time".
   *
   * Net effect: a venue opening any time before ten o'clock could not be
   * edited at all. The Wednesday row in the fixture opens at 9:00:00 for
   * exactly this reason.
   */
  it('saves a venue that opens before ten in the morning', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const dress = await screen.findByLabelText(/dress code/i)
    await user.clear(dress)
    await user.type(dress, 'Formal')
    await save(user)

    await waitFor(() => expect(venueById('VEN-00001').dress_code).toBe('Formal'))
    expect(
      screen.queryByText(/closing time must be after opening time/i),
    ).not.toBeInTheDocument()
  })

  it('shows that nine o’clock opening time instead of an empty box', async () => {
    renderApp({ route: EDIT, signedIn: true })

    const opening = await screen.findByLabelText(/Wednesday opening time/i)
    expect(opening).toHaveValue('09:00')
  })


describe('a save the server accepted and did not keep', () => {
  /**
   * REPORTED FROM THE LIVE SITE: "some fields on the venue screen do not
   * persist — e.g. the starting time, the moods."
   *
   * Neither was being reported as a failure, because as far as this code could
   * tell neither WAS one. Frappe discards a kwarg its whitelisted method does
   * not declare — silently, at HTTP 200. The save succeeds, the field is
   * dropped, the partner is told it worked, and they find out when a customer
   * turns up at nine for a ten o'clock opening.
   *
   * The fake bench could not model this until now: it stored everything it
   * accepted. Fourth time a double tidier than the server has hidden a bug.
   */
  it('tells the partner when the opening time did not stick', async () => {
    bench.silentlyDrops = ['operating_hours']
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const opening = await screen.findByLabelText(/Wednesday opening time/i)
    await user.clear(opening)
    await user.type(opening, '10:30')
    await save(user)

    expect(await screen.findByText(/the opening hours/i)).toBeInTheDocument()
    /* And the bench really did drop it — otherwise this proves nothing. */
    expect(venueById('VEN-00001').operating_hours[2].open_time).toBe('9:00:00')
  })

  it('says nothing when the save did stick', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const opening = await screen.findByLabelText(/Wednesday opening time/i)
    await user.clear(opening)
    await user.type(opening, '10:30')
    await save(user)

    await waitFor(() =>
      expect(venueById('VEN-00001').operating_hours[2].open_time).toBe('10:30'),
    )
    expect(screen.queryByText(/couldn’t update/i)).not.toBeInTheDocument()
  })

  /**
   * The false alarm this had to avoid. The form holds "09:00" and the bench
   * sends back "9:00:00" for the same moment, so a plain string comparison
   * would report every venue's hours as dropped on every single save — and a
   * warning that fires every time is one people learn to click through.
   */
  it('does not cry wolf over Frappe’s own way of writing a time', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const dress = await screen.findByLabelText(/dress code/i)
    await user.clear(dress)
    await user.type(dress, 'Formal')
    await save(user)

    await waitFor(() => expect(venueById('VEN-00001').dress_code).toBe('Formal'))
    expect(screen.queryByText(/the opening hours/i)).not.toBeInTheDocument()
  })
})


describe('moods, now that the bench has told us the shape', () => {
  /**
   * ANSWERED 5 Sep. `Venue.moods` is a Table MultiSelect onto `Venue Mood`,
   * whose single child field is `mood`, and bare names are accepted directly.
   *
   * The portal had been DROPPING moods from every edit on the theory that a
   * wrong child-row key would make Frappe write empty rows and report success.
   * That is real Frappe behaviour; it is not this endpoint's behaviour, and the
   * caution cost the feature for weeks.
   */
  it('saves a changed mood selection', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    await user.click(await screen.findByRole('button', { name: /^lively$/i }))
    await save(user)

    await waitFor(() => expect(venueById('VEN-00001').moods).toContain('MOOD-LIVELY'))
    expect(screen.queryByText(/couldn’t update the moods/i)).not.toBeInTheDocument()
  })

  /**
   * ⚠️ Setting moods REPLACES the whole set — `Document.set()` clears the table
   * before extending it. So an empty list is not "leave these alone", it is
   * "delete every mood this venue has". The form will not submit without one,
   * which makes an empty array here a bug on our side; sending it would turn
   * that bug into data loss.
   */
  it('never sends an empty mood list, which would erase them', async () => {
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const dress = await screen.findByLabelText(/dress code/i)
    await user.clear(dress)
    await user.type(dress, 'Formal')
    await save(user)

    await waitFor(() => expect(venueById('VEN-00001').dress_code).toBe('Formal'))
    const sent = bench.calls.filter((c) => c.method === 'update_venue')
    sent.forEach((c) => {
      if ('moods' in c.args) expect(c.args.moods.length).toBeGreaterThan(0)
    })
    expect(venueById('VEN-00001').moods.length).toBeGreaterThan(0)
  })
})

})

  it('saves when detail 404s AND the dashboard row describes moods differently', async () => {
    /* THE PRODUCTION COMBINATION, reported the same day for VEN-00008:

         GET …get_venue_detail?venue_name=VEN-00008  404

       With detail gone we read the dashboard row instead — a different
       serialiser over the same child table, under no obligation to agree with
       the one the form was written against. That is what makes the shape
       mismatch likely rather than theoretical, and the two reports are one
       incident. */
    bench.deploy.get_venue_detail = false
    bench.moodReadShape = 'rows'
    const { user } = renderApp({ route: EDIT, signedIn: true })

    const address = await screen.findByLabelText(/^address/i)
    await user.clear(address)
    await user.type(address, '9 Bree St, Cape Town')
    await user.click(screen.getByRole('button', { name: /save and resubmit|^save/i }))

    await waitFor(() => expect(venueById('VEN-00001').address).toBe('9 Bree St, Cape Town'))
    expect(screen.queryByText(/select at least one mood/i)).not.toBeInTheDocument()
  })
